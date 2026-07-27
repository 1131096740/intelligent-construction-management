import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, type SettlementDraft } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  type FrozenDraftBusinessSnapshot,
  settlementFrozenDocumentInput,
  settlementFrozenBusinessSnapshotToken
} from "./settlement-document-facts";
import {
  renderSettlementArchivePdf,
  type SettlementDocumentInput
} from "./settlement-document-renderer";
import { SettlementService } from "./settlement.service";
import type { CreateSettlementLineDto } from "./dto/create-settlement.dto";

type DraftDocumentFacts = Awaited<
  ReturnType<SettlementService["prepareDraftDocumentFacts"]>
>;

type LockedDraft = SettlementDraft;

type PreparedFrozenDocument = {
  draft: LockedDraft;
  input: SettlementDocumentInput;
  snapshot: FrozenDraftBusinessSnapshot;
  businessSnapshotToken: string;
};

@Injectable()
export class SettlementFrozenDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService,
    private readonly files: FileService,
    private readonly audit: AuditService
  ) {}

  async generate(
    projectId: string,
    draftId: string,
    actorUserId: string,
    expectedRevision: number
  ) {
    const prepared = await this.prisma.$transaction((tx) =>
      this.prepare(tx, projectId, draftId, actorUserId, expectedRevision)
    );
    const existing = await this.prisma.settlementSignedDocument.findFirst({
      where: {
        settlementDraftId: draftId,
        purpose: "frozen_counterparty_copy",
        status: "active",
        sourceRevision: expectedRevision,
        businessSnapshotToken: prepared.businessSnapshotToken
      }
    });
    if (existing) return existing;

    const buffer = await renderSettlementArchivePdf(prepared.input);
    const pdf = await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false
    });
    const pageCount = pdf.getPageCount();
    if (pageCount < 1) {
      throw new BadRequestException("冻结版结算单没有可用页面，请重新生成");
    }
    for (const page of pdf.getPages()) {
      const size = page.getSize();
      if (size.width <= size.height) {
        throw new BadRequestException("冻结版结算单未按 A4 横向生成，请联系管理员");
      }
    }

    const file = await this.files.uploadPrivateFile({
      originalName: `结算冻结版-${draftId}-R${expectedRevision}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    let keepUploadedFile = false;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const current = await this.prepare(
          tx,
          projectId,
          draftId,
          actorUserId,
          expectedRevision
        );
        if (current.businessSnapshotToken !== prepared.businessSnapshotToken) {
          throw new BadRequestException(
            "结算草稿、税务事实或前序结算已变化，请按最新事实重新生成冻结版"
          );
        }
        await this.lockDocuments(tx, draftId);
        const active = await tx.settlementSignedDocument.findFirst({
          where: {
            settlementDraftId: draftId,
            purpose: "frozen_counterparty_copy",
            status: "active"
          }
        });
        if (
          active?.sourceRevision === expectedRevision &&
          active.businessSnapshotToken === prepared.businessSnapshotToken
        ) {
          return { document: active, reused: true };
        }
        if (active) {
          await tx.settlementSignedDocument.update({
            where: { id: active.id },
            data: {
              status: "superseded",
              invalidatedAt: new Date(),
              invalidationReason:
                active.sourceRevision === expectedRevision
                  ? "税务、前序结算或付款阶段事实已变化，冻结版已重新生成"
                  : "结算草稿修订号已变化，冻结版已重新生成"
            }
          });
        }
        const created = await tx.settlementSignedDocument.create({
          data: {
            settlementDraftId: draftId,
            purpose: "frozen_counterparty_copy",
            fileId: file.id,
            contentSha256: file.contentSha256!,
            pageCount,
            sourceRevision: expectedRevision,
            businessSnapshotToken: prepared.businessSnapshotToken,
            status: "active",
            generationStatus: "completed",
            generatedByUserId: actorUserId,
            supersedesId: active?.id ?? null
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "settlement.frozen_document.generated",
          businessType: "settlement_draft",
          businessId: draftId,
          metadata: {
            documentId: created.id,
            sourceRevision: expectedRevision,
            pageCount,
            replacedDocumentId: active?.id ?? null
          }
        });
        return { document: created, reused: false };
      });
      keepUploadedFile = !result.reused;
      return result.document;
    } catch (error) {
      if (this.isConcurrentWrite(error)) {
        const winner = await this.prisma.settlementSignedDocument.findFirst({
          where: {
            settlementDraftId: draftId,
            purpose: "frozen_counterparty_copy",
            status: "active",
            sourceRevision: expectedRevision,
            businessSnapshotToken: prepared.businessSnapshotToken
          }
        });
        if (winner) return winner;
        throw new BadRequestException(
          "结算冻结版正在由其他请求更新，请刷新后重试"
        );
      }
      throw error;
    } finally {
      if (!keepUploadedFile) {
        await this.files
          .discardUnlinkedGeneratedFile(file.id, actorUserId)
          .catch(() => undefined);
      }
    }
  }

  async assertCurrentFacts(
    tx: Prisma.TransactionClient,
    draft: LockedDraft
  ) {
    const prepared = await this.prepare(
      tx,
      draft.projectId,
      draft.id,
      draft.ownerUserId,
      draft.revision,
      draft
    );
    await this.lockDocuments(tx, draft.id);
    const frozen = await tx.settlementSignedDocument.findFirst({
      where: {
        settlementDraftId: draft.id,
        purpose: "frozen_counterparty_copy",
        status: "active",
        sourceRevision: draft.revision
      }
    });
    if (!frozen) {
      throw new BadRequestException("请先按当前业务事实生成冻结版结算单");
    }
    if (frozen.businessSnapshotToken !== prepared.businessSnapshotToken) {
      throw new BadRequestException(
        "结算草稿、税务事实、前序结算或付款阶段已变化，请重新生成冻结版并由乙方重新签章"
      );
    }
    return frozen;
  }

  private async prepare(
    tx: Prisma.TransactionClient,
    projectId: string,
    draftId: string,
    actorUserId: string,
    expectedRevision: number,
    alreadyLockedDraft?: LockedDraft
  ): Promise<PreparedFrozenDocument> {
    if (!alreadyLockedDraft) {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SettlementDraft" WHERE "id" = ${draftId} FOR UPDATE
      `);
    }
    const draft =
      alreadyLockedDraft ??
      (await tx.settlementDraft.findUnique({ where: { id: draftId } }));
    if (!draft || draft.projectId !== projectId) {
      throw new BadRequestException("未找到当前项目的结算草稿，请刷新后重试");
    }
    if (draft.ownerUserId !== actorUserId) {
      throw new BadRequestException("只能由结算草稿经办人生成冻结版结算单");
    }
    if (
      draft.status !== "draft" ||
      draft.governanceVersion !== 1 ||
      draft.revision !== expectedRevision
    ) {
      throw new BadRequestException(
        "结算草稿已变化，不能生成或复用当前修订版冻结文件"
      );
    }

    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Contract" WHERE "id" = ${draft.contractId} FOR UPDATE
    `);
    const [contract, project, version] = await Promise.all([
      tx.contract.findUnique({ where: { id: draft.contractId } }),
      tx.project.findUnique({ where: { id: draft.projectId } }),
      tx.contractVersion.findUnique({ where: { id: draft.contractVersionId } })
    ]);
    if (!contract || !project || !version) {
      throw new BadRequestException(
        "结算草稿关联的项目、合同或合同版本事实不完整，不能生成冻结版"
      );
    }
    if (!contract.contractTypeKey) {
      throw new BadRequestException("结算草稿关联合同类型不完整，不能生成冻结版");
    }
    await this.settlements.freezeGovernedSettlementFacts(
      tx,
      contract,
      draft.isFinal,
      actorUserId,
      {
        draftId: draft.id,
        governanceVersion: 1,
        fieldReviewerUserId: draft.fieldReviewerUserId,
        fieldReviewerRoleKey: draft.fieldReviewerRoleKey,
        finalConfirmations: {
          finalScopeCompleted: draft.finalScopeCompleted,
          finalPriorSettlementsIncluded: draft.finalPriorSettlementsIncluded,
          finalNoOutstandingSettlements: draft.finalNoOutstandingSettlements,
          finalWithinContractCap: draft.finalWithinContractCap,
          finalNoFurtherOrdinarySettlements:
            draft.finalNoFurtherOrdinarySettlements
        }
      }
    );
    const calculated = (await this.settlements.prepareDraftDocumentFacts(
      tx,
      draft,
      await this.structuredDraftLines(tx, draft.id, draft.calculationVersion)
    )) as DraftDocumentFacts;
    const taxFacts = calculated.taxFacts;
    if (
      !["vat_general", "vat_special"].includes(taxFacts.invoiceType ?? "") ||
      !["single_rate", "multiple_rate"].includes(taxFacts.taxMode ?? "") ||
      taxFacts.defaultTaxRatePercent === null ||
      !Number.isSafeInteger(taxFacts.taxFactRevision) ||
      taxFacts.taxFactRevision < 0
    ) {
      throw new BadRequestException(
        "结算草稿引用的合同税务事实不完整，不能生成冻结版"
      );
    }
    const contractTypeKey = contract.contractTypeKey;
    const materialRoute = ["material_purchase", "equipment_rental"].includes(contractTypeKey);
    const laborRoute = ["labor_subcontract", "professional_subcontract"].includes(contractTypeKey);
    if ((!materialRoute && !laborRoute) ||
      (materialRoute && draft.fieldReviewerRoleKey !== "material_staff") ||
      (laborRoute && !["engineering_foreman", "engineering_tech"].includes(draft.fieldReviewerRoleKey ?? ""))) {
      throw new BadRequestException(
        "结算现场复核岗位与合同类型不一致，不能生成冻结版"
      );
    }
    const snapshot: FrozenDraftBusinessSnapshot = {
      draftId: draft.id,
      revision: draft.revision,
      settlementCode: draft.code,
      periodLabel: draft.periodLabel,
      settlementTemplateVersionId: draft.settlementTemplateVersionId,
      contractId: draft.contractId,
      contractVersionId: draft.contractVersionId,
      paymentTermsVersionId: draft.paymentTermsVersionId,
      projectName: project.name,
      contractCode: contract.code ?? contract.id,
      contractName: contract.name,
      contractTypeKey: contract.contractTypeKey,
      counterparty: contract.counterparty,
      companyEntityName:
        version.companyEntityNameSnapshot ??
        contract.companyEntityName ??
        "我方主体",
      taxFactRevision: taxFacts.taxFactRevision,
      invoiceType: taxFacts.invoiceType,
      taxMode: taxFacts.taxMode!,
      defaultTaxRatePercent: taxFacts.defaultTaxRatePercent,
      isFinal: draft.isFinal,
      fieldReviewerUserId: draft.fieldReviewerUserId,
      fieldReviewerRoleKey: draft.fieldReviewerRoleKey,
      calculated
    };
    const businessSnapshotToken =
      settlementFrozenBusinessSnapshotToken(snapshot);
    const input = settlementFrozenDocumentInput(snapshot, new Date());
    return { draft, input, snapshot, businessSnapshotToken };
  }

  private async structuredDraftLines(
    tx: Prisma.TransactionClient,
    settlementDraftId: string,
    calculationVersion: number | null
  ): Promise<CreateSettlementLineDto[] | undefined> {
    const rows = await tx.settlementDraftLine.findMany({
      where: { settlementDraftId, status: "active" },
      orderBy: { sortOrder: "asc" }
    });
    if (!rows.length) {
      if ((calculationVersion ?? 0) >= 3) {
        throw new BadRequestException("结算草稿缺少结构化明细，请重新保存后再生成冻结版");
      }
      return undefined;
    }
    return rows.map((line) => ({
      sourceType: line.sourceType as CreateSettlementLineDto["sourceType"],
      lineKey: line.lineKey,
      ...(line.contractBillRowId ? { contractBillRowId: line.contractBillRowId } : {}),
      ...(line.sourceItemType ? { sourceItemType: line.sourceItemType } : {}),
      ...(line.occurredOn ? { occurredOn: line.occurredOn.toISOString().slice(0, 10) } : {}),
      name: line.name,
      ...(line.description ? { description: line.description } : {}),
      ...(line.unit ? { unit: line.unit } : {}),
      ...(line.quantity ? { quantity: line.quantity.toString() } : {}),
      ...(line.unitPriceCents !== null
        ? { unitPriceCents: line.unitPriceCents.toString() }
        : {}),
      ...(line.directAmountCents !== null
        ? { amountCents: line.directAmountCents.toString() }
        : {}),
      ...(line.pricingBasis ? { pricingBasis: line.pricingBasis } : {}),
      ...(line.relatedSettlementLineId
        ? { relatedSettlementLineId: line.relatedSettlementLineId }
        : {}),
      ...(line.reason ? { reason: line.reason } : {}),
      ...(line.remark ? { remark: line.remark } : {}),
      sortOrder: line.sortOrder
    }));
  }

  private async lockDocuments(tx: Prisma.TransactionClient, draftId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "SettlementSignedDocument"
      WHERE "settlementDraftId" = ${draftId}
      ORDER BY "createdAt", "id" FOR UPDATE
    `);
  }

  private isConcurrentWrite(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const value = error as { code?: unknown; meta?: { code?: unknown } };
    return (
      value.code === "P2002" ||
      value.code === "P2034" ||
      value.code === "40001" ||
      value.meta?.code === "40001"
    );
  }
}

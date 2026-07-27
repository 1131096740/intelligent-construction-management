import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type {
  CreateSettlementDto,
  CreateSettlementLineDto
} from "./dto/create-settlement.dto";
import { SettlementService } from "./settlement.service";
import { SettlementCounterpartyDocumentService } from "./settlement-counterparty-document.service";
import { SettlementFrozenDocumentService } from "./settlement-frozen-document.service";
import { ContractSettlementProcessService } from "./contract-settlement-process.service";
import { settlementSourceSnapshotToken } from "./settlement-line-occupancy";
import { SettlementLineAttachmentService } from "./settlement-line-attachment.service";

@Injectable()
export class SettlementSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService,
    @Optional() private readonly counterpartyDocuments?: SettlementCounterpartyDocumentService,
    @Optional() private readonly frozenDocuments?: SettlementFrozenDocumentService,
    @Optional() private readonly processes?: ContractSettlementProcessService,
    @Optional() private readonly lineAttachments?: SettlementLineAttachmentService
  ) {}

  submit(input: CreateSettlementDto, applicantUserId: string) {
    void input;
    void applicantUserId;
    throw new BadRequestException(
      "请从结算工作台保存草稿、选择现场复核人并完成乙方签章文件后提交"
    );
  }

  async submitDraft(
    projectId: string,
    draftId: string,
    applicantUserId: string,
    expectedRevision: number
  ) {
    let settlement;
    try {
      settlement = await this.prisma.$transaction(
        async (tx) => {
          const lockedDraft = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "SettlementDraft"
            WHERE "id" = ${draftId}
            FOR UPDATE
          `);
          if (lockedDraft.length !== 1) {
            throw new NotFoundException("未找到结算草稿，请刷新后重试");
          }
          const draft = await tx.settlementDraft.findUnique({
            where: { id: draftId }
          });
          if (!draft || draft.projectId !== projectId) {
            throw new NotFoundException("未找到结算草稿，请刷新后重试");
          }
          if (draft.ownerUserId !== applicantUserId) {
            throw new ForbiddenException("只能提交本人创建的结算草稿");
          }
          if (draft.status !== "draft") {
            throw new BadRequestException("结算草稿已经提交，不能重复发起审批");
          }
          if (draft.revision !== expectedRevision) {
            throw new BadRequestException("结算草稿已被更新，请刷新后重新确认提交");
          }
          if (draft.governanceVersion !== 1) {
            throw new BadRequestException(
              "当前旧草稿尚未适配新结算规则，请先在结算工作台重新保存并补齐现场复核人与乙方签章文件"
            );
          }
          if (!this.counterpartyDocuments) {
            throw new BadRequestException("结算签章文件门禁暂不可用，请稍后重试");
          }
          if (!this.frozenDocuments) {
            throw new BadRequestException("结算冻结事实复核服务暂不可用，请稍后重试");
          }
          await this.frozenDocuments.assertCurrentFacts(tx, draft);
          await this.counterpartyDocuments.assertReadyForSubmission(tx, draft);
          const settlementLines = await this.submissionLines(tx, draft);
          if ((draft.calculationVersion ?? 0) >= 2) {
            const currentSourceSnapshotToken = await settlementSourceSnapshotToken(
              tx,
              draft.contractVersionId,
              settlementLines
            );
            if (currentSourceSnapshotToken !== draft.sourceSnapshotToken) {
              throw new ConflictException({
                code: "SETTLEMENT_SOURCE_OCCUPANCY_CHANGED",
                message: "结算草稿引用的清单来源或历史占用已变化，请刷新工作台、重新核对本期数量后再提交。"
              });
            }
          }

          const claimed = await tx.settlementDraft.updateMany({
            where: {
              id: draftId,
              projectId,
              ownerUserId: applicantUserId,
              status: "draft",
              revision: expectedRevision
            },
            data: { revision: { increment: 1 } }
          });
          if (claimed.count !== 1) {
            throw new BadRequestException("结算草稿已被更新，请刷新后重新确认提交");
          }

          const prepared = this.settlements.prepareSubmission(
            this.submissionInput(draft, settlementLines)
          );
          const created = await this.settlements.submitInTransaction(
            tx,
            prepared,
            applicantUserId,
            {
              draftId: draft.id,
              processId: draft.processId,
              periodStart: draft.periodStart,
              periodEnd: draft.periodEnd,
              governanceVersion: 1,
              fieldReviewerUserId: draft.fieldReviewerUserId,
              fieldReviewerRoleKey: draft.fieldReviewerRoleKey,
              finalConfirmations: {
                finalScopeCompleted: draft.finalScopeCompleted,
                finalPriorSettlementsIncluded: draft.finalPriorSettlementsIncluded,
                finalNoOutstandingSettlements: draft.finalNoOutstandingSettlements,
                finalWithinContractCap: draft.finalWithinContractCap,
                finalNoFurtherOrdinarySettlements: draft.finalNoFurtherOrdinarySettlements
              }
            }
          );
          if (this.lineAttachments) {
            await this.lineAttachments.copyActiveDraftAttachmentsToSettlement(
              tx,
              draft.id,
              created.id,
              applicantUserId
            );
          }
          const marked = await tx.settlementDraft.updateMany({
            where: {
              id: draftId,
              status: "draft",
              revision: expectedRevision + 1
            },
            data: {
              status: "submitted",
              submittedSettlementId: created.id,
              submittedAt: new Date()
            }
          });
          if (marked.count !== 1) {
            throw new BadRequestException("结算草稿状态已变化，请刷新结算台账核对");
          }
          if (draft.processId) {
            await this.processes?.linkSettlement(tx, draft.processId, draft.id, created.id);
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (error) {
      await this.settlements.persistContractCapacityDenial?.(error, applicantUserId);
      await this.settlements.persistGovernanceDenial?.(error, applicantUserId, draftId);
      await this.counterpartyDocuments?.persistDenial(draftId, applicantUserId, error);
      this.settlements.rethrowSubmissionError(error);
    }

    return this.settlements.finalizeSubmission(settlement, applicantUserId);
  }

  private async submissionLines(
    tx: Prisma.TransactionClient,
    draft: { id: string; calculationVersion: number | null; lines: Prisma.JsonValue }
  ): Promise<CreateSettlementLineDto[]> {
    const structuredLines = await tx.settlementDraftLine.findMany({
      where: { settlementDraftId: draft.id, status: "active" },
      orderBy: { sortOrder: "asc" }
    });
    if (structuredLines.length) {
      return structuredLines.map((line) => ({
        sourceType: line.sourceType as CreateSettlementLineDto["sourceType"],
        lineKey: line.lineKey,
        ...(line.contractBillRowId ? { contractBillRowId: line.contractBillRowId } : {}),
        ...(line.sourceItemType ? { sourceItemType: line.sourceItemType } : {}),
        ...(line.occurredOn ? { occurredOn: line.occurredOn.toISOString().slice(0, 10) } : {}),
        ...(line.name ? { name: line.name } : {}),
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
    if ((draft.calculationVersion ?? 0) >= 3) {
      throw new BadRequestException("结算草稿缺少结构化明细，请重新保存后再提交");
    }
    if (!Array.isArray(draft.lines)) {
      throw new BadRequestException("结算草稿明细已损坏，请重新保存后再提交");
    }
    return draft.lines as unknown as CreateSettlementLineDto[];
  }

  private submissionInput(draft: {
    contractVersionId: string;
    settlementTemplateVersionId: string | null;
    code: string;
    periodLabel: string;
    isFinal: boolean;
    finalCumulativeAmountCents: bigint | null;
    processId?: string | null;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    lines: Prisma.JsonValue;
    governanceVersion?: number | null;
  }, settlementLines: CreateSettlementLineDto[]): CreateSettlementDto {
    return {
      contractVersionId: draft.contractVersionId,
      ...(draft.settlementTemplateVersionId
        ? { settlementTemplateVersionId: draft.settlementTemplateVersionId }
        : {}),
      code: draft.code,
      periodLabel: draft.periodLabel,
      isFinal: draft.isFinal,
      ...(draft.isFinal && draft.finalCumulativeAmountCents !== null
        ? { amountCents: draft.finalCumulativeAmountCents.toString() }
        : {}),
      settlementLines
    };
  }
}

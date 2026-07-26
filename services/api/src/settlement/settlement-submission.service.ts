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

@Injectable()
export class SettlementSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService,
    @Optional() private readonly counterpartyDocuments?: SettlementCounterpartyDocumentService,
    @Optional() private readonly frozenDocuments?: SettlementFrozenDocumentService,
    @Optional() private readonly processes?: ContractSettlementProcessService
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
          if (draft.calculationVersion === 2) {
            if (!Array.isArray(draft.lines)) {
              throw new BadRequestException("结算草稿明细已损坏，请重新保存后再提交");
            }
            const currentSourceSnapshotToken = await settlementSourceSnapshotToken(
              tx,
              draft.contractVersionId,
              draft.lines as Array<{ contractBillRowId?: string | null }>
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
            this.submissionInput(draft)
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
  }): CreateSettlementDto {
    if (!Array.isArray(draft.lines)) {
      throw new BadRequestException("结算草稿明细已损坏，请重新保存草稿后再提交");
    }
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
      settlementLines: draft.lines as unknown as CreateSettlementLineDto[]
    };
  }
}

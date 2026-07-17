import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type {
  CreateSettlementDto,
  CreateSettlementLineDto
} from "./dto/create-settlement.dto";
import { SettlementService } from "./settlement.service";

@Injectable()
export class SettlementSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService
  ) {}

  submit(input: CreateSettlementDto, applicantUserId: string) {
    return this.settlements.create(input, applicantUserId);
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
            applicantUserId
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
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (error) {
      await this.settlements.persistContractCapacityDenial?.(error, applicantUserId);
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
    lines: Prisma.JsonValue;
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

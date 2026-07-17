import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canCreateSettlementFromContractStatus,
  type ContractVersionStatus
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { parseMoneyCentsInput } from "../money/decimal-money";
import type { SaveSettlementDraftDto } from "./dto/settlement-draft.dto";
import {
  assertSettlementContractType,
  settlementContractTypeBlockReason
} from "./contract-settlement-capacity";

@Injectable()
export class SettlementDraftService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    projectId: string,
    actorUserId: string,
    input: SaveSettlementDraftDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.contractContext(
        tx,
        projectId,
        input.contractVersionId
      );
      const created = await tx.settlementDraft.create({
        data: {
          projectId: context.contract.projectId,
          contractId: context.version.contractId,
          contractVersionId: context.version.id,
          paymentTermsVersionId: context.terms.id,
          settlementTemplateVersionId: input.settlementTemplateVersionId.trim(),
          code: input.code.trim(),
          periodLabel: input.periodLabel.trim(),
          isFinal: input.isFinal === true,
          finalCumulativeAmountCents: this.finalAmount(input),
          lines: this.toJson(input.settlementLines),
          ownerUserId: actorUserId
        }
      });
      return this.readModel(created);
    });
  }

  async list(projectId: string, actorUserId: string) {
    const drafts = await this.prisma.settlementDraft.findMany({
      where: { projectId, ownerUserId: actorUserId },
      orderBy: { updatedAt: "desc" }
    });
    const contracts = drafts.length ? await this.prisma.contract.findMany({
      where: { id: { in: [...new Set(drafts.map((draft) => draft.contractId))] } },
      select: { id: true, contractTypeKey: true }
    }) : [];
    const typeByContract = new Map(contracts.map((contract) => [contract.id, contract.contractTypeKey]));
    return drafts.map((draft) => this.readModel(
      draft,
      settlementContractTypeBlockReason(typeByContract.get(draft.contractId))
    ));
  }

  async get(projectId: string, draftId: string, actorUserId: string) {
    const draft = await this.prisma.settlementDraft.findUnique({
      where: { id: draftId }
    });
    this.assertOwnedDraft(draft, projectId, actorUserId);
    const contract = await this.prisma.contract.findUnique({
      where: { id: draft!.contractId },
      select: { contractTypeKey: true }
    });
    return this.readModel(draft!, settlementContractTypeBlockReason(contract?.contractTypeKey));
  }

  async update(
    projectId: string,
    draftId: string,
    actorUserId: string,
    input: SaveSettlementDraftDto
  ) {
    if (input.expectedRevision === undefined) {
      throw new BadRequestException("更新结算草稿时必须提供当前修订号");
    }
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.settlementDraft.findUnique({
        where: { id: draftId }
      });
      this.assertOwnedDraft(draft, projectId, actorUserId);
      if (draft!.status !== "draft") {
        throw new BadRequestException("结算草稿已提交，不能再次修改");
      }
      if (draft!.revision !== input.expectedRevision) {
        throw new BadRequestException("结算草稿已被更新，请刷新后继续编辑");
      }
      const originalContract = await tx.contract.findUnique({
        where: { id: draft!.contractId },
        select: { contractTypeKey: true }
      });
      assertSettlementContractType(originalContract?.contractTypeKey);
      const context = await this.contractContext(
        tx,
        projectId,
        input.contractVersionId
      );
      const updated = await tx.settlementDraft.updateMany({
        where: {
          id: draftId,
          projectId,
          ownerUserId: actorUserId,
          status: "draft",
          revision: input.expectedRevision
        },
        data: {
          contractId: context.version.contractId,
          contractVersionId: context.version.id,
          paymentTermsVersionId: context.terms.id,
          settlementTemplateVersionId: input.settlementTemplateVersionId.trim(),
          code: input.code.trim(),
          periodLabel: input.periodLabel.trim(),
          isFinal: input.isFinal === true,
          finalCumulativeAmountCents: this.finalAmount(input),
          lines: this.toJson(input.settlementLines),
          revision: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("结算草稿已被更新，请刷新后继续编辑");
      }
      const result = await tx.settlementDraft.findUnique({
        where: { id: draftId }
      });
      if (!result) {
        throw new NotFoundException("未找到结算草稿，请刷新后重试");
      }
      return this.readModel(result);
    });
  }

  private async contractContext(
    tx: Prisma.TransactionClient,
    projectId: string,
    contractVersionId: string
  ) {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) {
      throw new NotFoundException("未找到合同版本，请刷新合同选择后重试");
    }
    if (
      !canCreateSettlementFromContractStatus(
        version.status as ContractVersionStatus
      )
    ) {
      throw new BadRequestException("合同尚未归档生效，暂时只能保留现有输入，不能新建结算草稿");
    }
    const contract = await tx.contract.findUnique({
      where: { id: version.contractId }
    });
    if (!contract) {
      throw new NotFoundException("未找到结算关联合同，请刷新合同台账后重试");
    }
    assertSettlementContractType(contract.contractTypeKey);
    if (contract.projectId !== projectId) {
      throw new BadRequestException("合同版本不属于当前项目，不能保存到该项目的结算草稿");
    }
    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId: version.id, status: "effective" },
      orderBy: { versionNo: "desc" }
    });
    if (!terms) {
      throw new BadRequestException(
        "合同缺少已生效的结构化付款条款，当前输入暂不能保存为可提交草稿"
      );
    }
    return { version, contract, terms };
  }

  private assertOwnedDraft(
    draft:
      | {
          projectId: string;
          ownerUserId: string;
        }
      | null,
    projectId: string,
    actorUserId: string
  ): void {
    if (!draft || draft.projectId !== projectId) {
      throw new NotFoundException("未找到结算草稿，请刷新后重试");
    }
    if (draft.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只能查看和修改本人创建的结算草稿");
    }
  }

  private finalAmount(input: SaveSettlementDraftDto): bigint | null {
    if (input.isFinal !== true) return null;
    if (input.finalCumulativeAmountCents === undefined) return null;
    return parseMoneyCentsInput(
      input.finalCumulativeAmountCents,
      "审定累计结算金额",
      "审定累计结算金额必须按分填写为 0 或更大的整数"
    );
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private readModel<T>(
    draft: T,
    submissionBlockingReason: string | null = null
  ): T & { submissionBlockingReason: string | null } {
    return {
      ...(JSON.parse(
      JSON.stringify(draft, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value
      )
      ) as T),
      submissionBlockingReason
    };
  }
}

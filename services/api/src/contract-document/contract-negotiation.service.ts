import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { contractDocumentCandidateMatchesLedger } from "./contract-document-ledger-candidate";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EDITABLE_VERSION_STATUSES = ["draft"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DISPOSITIONS = new Set([
  "confirmed",
  "rejected",
  "no_material_change"
]);

export interface OpenNegotiationRoundInput {
  note?: string;
}

export interface UploadNegotiationRevisionInput {
  fileId: string;
  label?: string;
  note?: string;
  confirmationStatementAccepted: boolean;
}

export interface DisposeContractDifferenceInput {
  disposition: "confirmed" | "rejected" | "no_material_change";
  reason?: string;
}

export interface CreateOfflineRevisionPreviewTicketInput {
  confirmationPassword: string;
  downloadReason: string;
}

@Injectable()
export class ContractNegotiationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly auth: AuthService
  ) {}

  async openRound(
    contractVersionId: string,
    actorUserId: string,
    input: OpenNegotiationRoundInput = {}
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { version } = await this.loadOwnedEditableVersionForUpdate(
          tx,
          contractVersionId,
          actorUserId
        );
        const open = await tx.contractNegotiationRound.findFirst({
          where: { contractVersionId: version.id, status: "open" }
        });
        if (open) throw new BadRequestException("当前合同已有开放的磋商轮次，请先处理或关闭");
        if (
          !Number.isInteger(version.documentContentRevision) ||
          version.documentContentRevision < 1 ||
          !version.documentContentFingerprint ||
          !SHA256_PATTERN.test(version.documentContentFingerprint)
        ) {
          throw new BadRequestException("请先生成当前修订的合同 DOCX，再开启磋商轮次");
        }
        const source = await tx.contractGeneratedDocument.findFirst({
          where: {
            contractVersionId: version.id,
            status: "success",
            docxFileId: { not: null },
            AND: [
              {
                inputSnapshot: {
                  path: ["documentContentRevision"],
                  equals: version.documentContentRevision
                }
              },
              {
                inputSnapshot: {
                  path: ["documentContentFingerprint"],
                  equals: version.documentContentFingerprint
                }
              }
            ]
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        });
        if (!source?.docxFileId) {
          throw new BadRequestException("请先生成当前修订的合同 DOCX，再开启磋商轮次");
        }
        const aggregate = await tx.contractNegotiationRound.aggregate({
          where: { contractVersionId: version.id },
          _max: { roundNo: true }
        });
        const round = await tx.contractNegotiationRound.create({
          data: {
            contractVersionId: version.id,
            roundNo: (aggregate._max.roundNo ?? 0) + 1,
            status: "open",
            sourceGeneratedDocumentId: source.id,
            sourceRevision: source.sourceRevision,
            note: this.optionalText(input.note, 1_000, "磋商轮次说明"),
            openedByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "contract.negotiation_round.open",
          businessType: "contract_negotiation_round",
          businessId: round.id,
          metadata: {
            contractVersionId: version.id,
            roundNo: round.roundNo,
            sourceGeneratedDocumentId: source.id,
            sourceRevision: source.sourceRevision
          }
        });
        return {
          id: round.id,
          roundNo: round.roundNo,
          status: round.status,
          sourceRevision: round.sourceRevision,
          note: round.note,
          openedAt: round.openedAt,
          closedAt: round.closedAt
        };
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new BadRequestException("当前合同已有开放的磋商轮次，请刷新后继续处理");
      }
      throw error;
    }
  }

  async uploadRevision(
    contractVersionId: string,
    actorUserId: string,
    rawInput: UploadNegotiationRevisionInput
  ) {
    const input = this.parseUploadInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedEditableVersionForUpdate(
        tx,
        contractVersionId,
        actorUserId
      );
      const round = await tx.contractNegotiationRound.findFirst({
        where: { contractVersionId: version.id, status: "open" },
        orderBy: [{ roundNo: "desc" }, { id: "desc" }]
      });
      if (!round) throw new BadRequestException("请先开启磋商轮次，再上传线下修订稿");
      const lockedRound = await this.lockRound(tx, round.id);
      if (!lockedRound || lockedRound.status !== "open") {
        throw new BadRequestException("磋商轮次状态已变化，请刷新后重试");
      }
      const source = await tx.contractGeneratedDocument.findUnique({
        where: { id: lockedRound.sourceGeneratedDocumentId }
      });
      if (
        !source ||
        source.contractVersionId !== version.id ||
        source.status !== "success" ||
        source.sourceRevision !== lockedRound.sourceRevision ||
        !source.docxFileId
      ) {
        throw new BadRequestException("磋商轮次来源文档异常，请关闭本轮后重新开启");
      }
      const file = await this.files.assertCanDownloadFile(tx, input.fileId, actorUserId);
      if (file.mimeType !== DOCX_MIME && !file.originalName.toLowerCase().endsWith(".docx")) {
        throw new BadRequestException("线下修订稿必须上传 DOCX 文档");
      }
      await this.files.linkFileReplacement(tx, {
        newFileId: input.fileId,
        oldFileId: source.docxFileId,
        actorUserId
      });
      const revision = await tx.contractOfflineRevision.create({
        data: {
          contractVersionId: version.id,
          negotiationRoundId: lockedRound.id,
          sourceGeneratedDocumentId: source.id,
          sourceRevision: lockedRound.sourceRevision,
          fileId: input.fileId,
          status: "queued",
          label: input.label,
          note: input.note,
          confirmedByUserId: actorUserId
        }
      });
      const comparison = await tx.contractDocumentComparison.create({
        data: {
          negotiationRoundId: lockedRound.id,
          offlineRevisionId: revision.id,
          sourceRevision: lockedRound.sourceRevision,
          status: "queued"
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.offline_revision.upload",
        businessType: "contract_offline_revision",
        businessId: revision.id,
        metadata: {
          contractVersionId: version.id,
          negotiationRoundId: lockedRound.id,
          sourceGeneratedDocumentId: source.id,
          sourceRevision: lockedRound.sourceRevision,
          comparisonId: comparison.id,
          newFileId: input.fileId,
          oldFileId: source.docxFileId,
          replacementKind: "contract_offline_revision_from_round_source"
        }
      });
      return {
        id: revision.id,
        status: revision.status,
        label: revision.label,
        hasPreviewPdf: false,
        comparison: { id: comparison.id, status: comparison.status }
      };
    });
  }

  async listRounds(contractVersionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedVersion(tx, contractVersionId, actorUserId);
      const rounds = await tx.contractNegotiationRound.findMany({
        where: { contractVersionId: version.id },
        orderBy: [{ roundNo: "desc" }, { id: "desc" }]
      });
      const result = [];
      for (const round of rounds) {
        const revisions = await tx.contractOfflineRevision.findMany({
          where: { negotiationRoundId: round.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        });
        const comparisons = revisions.length
          ? await tx.contractDocumentComparison.findMany({
              where: { offlineRevisionId: { in: revisions.map((item) => item.id) } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }]
            })
          : [];
        const differences = comparisons.length
          ? await tx.contractDocumentDifference.findMany({
              where: { comparisonId: { in: comparisons.map((item) => item.id) } },
              orderBy: [{ comparisonId: "asc" }, { sortOrder: "asc" }]
            })
          : [];
        result.push({
          id: round.id,
          roundNo: round.roundNo,
          status: round.status,
          sourceRevision: round.sourceRevision,
          note: round.note,
          openedAt: round.openedAt,
          closedAt: round.closedAt,
          revisions: revisions.map((revision) => {
            const comparison = comparisons.find((item) => item.offlineRevisionId === revision.id);
            return {
              id: revision.id,
              label: revision.label,
              note: revision.note,
              status: revision.status,
              hasPreviewPdf:
                revision.status === "succeeded" && Boolean(revision.previewPdfFileId),
              errorMessage: revision.errorMessage,
              createdAt: revision.createdAt,
              completedAt: revision.completedAt,
              comparison: comparison
                ? {
                    id: comparison.id,
                    status: comparison.status,
                    algorithmVersion: comparison.algorithmVersion,
                    errorMessage: comparison.errorMessage,
                    completedAt: comparison.completedAt,
                    differences: differences
                      .filter((item) => item.comparisonId === comparison.id)
                      .map((difference) => ({
                        id: difference.id,
                        sortOrder: difference.sortOrder,
                        changeType: difference.changeType,
                        kind: difference.kind,
                        locationPath: difference.locationPath,
                        basePath: difference.basePath,
                        revisedPath: difference.revisedPath,
                        beforeText: difference.beforeText,
                        afterText: difference.afterText,
                        candidate: difference.candidate,
                        disposition: difference.disposition,
                        dispositionReason: difference.dispositionReason,
                        disposedAt: difference.disposedAt
                      }))
                  }
                : null
            };
          })
        });
      }
      return result;
    });
  }

  async listOfflineRevisionHistory(contractVersionId: string, actorUserId: string) {
    const rounds = await this.listRounds(contractVersionId, actorUserId);
    const governed = rounds.flatMap((round) =>
      round.revisions.map((revision) => ({
        ...revision,
        negotiationRound: {
          id: round.id,
          roundNo: round.roundNo,
          status: round.status,
          sourceRevision: round.sourceRevision
        }
      }))
    );
    const legacy = await this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedVersion(tx, contractVersionId, actorUserId);
      const revisions = await tx.contractOfflineRevision.findMany({
        where: { contractVersionId: version.id, negotiationRoundId: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      return revisions.map((revision) => ({
        id: revision.id,
        label: revision.label,
        note: revision.note,
        status: revision.status,
        hasPreviewPdf: false,
        errorMessage: revision.errorMessage,
        createdAt: revision.createdAt,
        completedAt: revision.completedAt,
        comparison: null,
        negotiationRound: null
      }));
    });
    return [...governed, ...legacy].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
  }

  async createPreviewDownloadTicket(
    revisionId: string,
    actorUserId: string,
    input: CreateOfflineRevisionPreviewTicketInput
  ) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请填写线下修订稿预览下载信息");
    }
    if (typeof input.confirmationPassword !== "string" || !input.confirmationPassword.trim()) {
      throw new BadRequestException("请输入当前登录密码后再下载线下修订稿预览");
    }
    const downloadReason = this.optionalText(input.downloadReason, 200, "下载原因");
    if (!downloadReason) throw new BadRequestException("请填写下载原因，便于留痕审计");
    const previewPdfFileId = await this.prisma.$transaction(async (tx) => {
      const revision = await tx.contractOfflineRevision.findUnique({
        where: { id: revisionId }
      });
      if (!revision) throw new NotFoundException("未找到线下修订稿，请刷新后重试");
      await this.loadOwnedVersion(tx, revision.contractVersionId, actorUserId);
      if (revision.status !== "succeeded" || !revision.previewPdfFileId) {
        throw new BadRequestException("线下修订稿预览尚未生成成功，暂不能下载");
      }
      return revision.previewPdfFileId;
    });
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    const ticket = await this.files.createDownloadTicket(previewPdfFileId, {
      actorUserId,
      downloadReason
    });
    return {
      fileName: ticket.fileName,
      mimeType: ticket.mimeType,
      sizeBytes: ticket.sizeBytes,
      expiresAt: ticket.expiresAt,
      downloadUrl: ticket.downloadUrl
    };
  }

  async disposeDifference(
    differenceId: string,
    actorUserId: string,
    rawInput: DisposeContractDifferenceInput
  ) {
    const input = this.parseDispositionInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const difference = await tx.contractDocumentDifference.findUnique({
        where: { id: differenceId }
      });
      if (!difference) throw new NotFoundException("未找到合同文档差异，请刷新后重试");
      const comparison = await tx.contractDocumentComparison.findUnique({
        where: { id: difference.comparisonId }
      });
      if (!comparison || comparison.status !== "succeeded") {
        throw new BadRequestException("合同文档比较尚未完成，暂不能处理差异");
      }
      const roundSnapshot = await tx.contractNegotiationRound.findUnique({
        where: { id: comparison.negotiationRoundId }
      });
      if (!roundSnapshot || roundSnapshot.status !== "open") {
        throw new BadRequestException("磋商轮次已关闭，不能修改差异处置结果");
      }
      const { version } = await this.loadOwnedEditableVersionForUpdate(
        tx,
        roundSnapshot.contractVersionId,
        actorUserId
      );
      const round = await this.lockRound(tx, roundSnapshot.id);
      if (!round || round.status !== "open") {
        throw new BadRequestException("磋商轮次已关闭，不能修改差异处置结果");
      }
      if (difference.disposition !== "pending") {
        throw new BadRequestException("该差异已处理，请刷新后查看结果");
      }
      if (input.disposition === "confirmed" && difference.candidate) {
        if (!contractDocumentCandidateMatchesLedger(difference.candidate, version)) {
          throw new BadRequestException(
            "结构候选与当前合同账本不一致，请先人工修改账本并保存，再确认该差异"
          );
        }
      }
      const disposedAt = new Date();
      const updated = await tx.contractDocumentDifference.updateMany({
        where: { id: difference.id, disposition: "pending" },
        data: {
          disposition: input.disposition,
          dispositionReason: input.reason,
          disposedByUserId: actorUserId,
          disposedAt
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("该差异已被处理，请刷新后查看结果");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.document_difference.dispose",
        businessType: "contract_document_difference",
        businessId: difference.id,
        metadata: {
          contractVersionId: version.id,
          negotiationRoundId: round.id,
          comparisonId: comparison.id,
          disposition: input.disposition,
          reason: input.reason,
          candidateKind: this.object(difference.candidate)["kind"] ?? null
        }
      });
      return {
        id: difference.id,
        disposition: input.disposition,
        dispositionReason: input.reason,
        disposedAt
      };
    });
  }

  async closeRound(roundId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const roundSnapshot = await tx.contractNegotiationRound.findUnique({
        where: { id: roundId }
      });
      if (!roundSnapshot) {
        throw new NotFoundException("未找到合同磋商轮次，请刷新后重试");
      }
      const { version } = await this.loadOwnedEditableVersionForUpdate(
        tx,
        roundSnapshot.contractVersionId,
        actorUserId
      );
      const round = await this.lockRound(tx, roundId);
      if (!round) throw new NotFoundException("未找到合同磋商轮次，请刷新后重试");
      if (round.status !== "open") throw new BadRequestException("该磋商轮次已经关闭");
      const revisions = await tx.contractOfflineRevision.findMany({
        where: { negotiationRoundId: round.id }
      });
      const comparisons = await tx.contractDocumentComparison.findMany({
        where: { negotiationRoundId: round.id }
      });
      if (revisions.length === 0 || comparisons.length === 0) {
        throw new BadRequestException(
          "本轮至少上传并完成一份线下修订稿比较后才能关闭"
        );
      }
      if (
        revisions.some(
          (revision) =>
            revision.status !== "succeeded" ||
            !comparisons.some(
              (comparison) =>
                comparison.offlineRevisionId === revision.id &&
                comparison.status === "succeeded"
            )
        ) ||
        comparisons.some((comparison) => comparison.status !== "succeeded")
      ) {
        throw new BadRequestException("本轮仍有未完成或失败的文档比较，暂不能关闭");
      }
      const pending = await tx.contractDocumentDifference.findFirst({
        where: {
          comparisonId: { in: comparisons.map((comparison) => comparison.id) },
          disposition: "pending"
        },
        select: { id: true }
      });
      if (pending) throw new BadRequestException("本轮仍有待处理差异，暂不能关闭");
      const closedAt = new Date();
      const updated = await tx.contractNegotiationRound.updateMany({
        where: { id: round.id, status: "open" },
        data: { status: "closed", closedByUserId: actorUserId, closedAt }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("磋商轮次状态已变化，请刷新后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.negotiation_round.close",
        businessType: "contract_negotiation_round",
        businessId: round.id,
        metadata: { contractVersionId: version.id, roundNo: round.roundNo }
      });
      return {
        id: round.id,
        roundNo: round.roundNo,
        status: "closed",
        sourceRevision: round.sourceRevision,
        note: round.note,
        openedAt: round.openedAt,
        closedAt
      };
    });
  }

  async retryRevision(revisionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const revision = await tx.contractOfflineRevision.findUnique({ where: { id: revisionId } });
      if (!revision) throw new NotFoundException("未找到线下修订稿，请刷新后重试");
      if (revision.status !== "failed") {
        throw new BadRequestException("只有处理失败的线下修订稿可以重试");
      }
      if (!revision.negotiationRoundId) {
        throw new BadRequestException("磋商轮次已关闭，不能重试线下修订稿");
      }
      await this.loadOwnedEditableVersionForUpdate(
        tx,
        revision.contractVersionId,
        actorUserId
      );
      const round = await this.lockRound(tx, revision.negotiationRoundId);
      if (!round || round.status !== "open") {
        throw new BadRequestException("磋商轮次已关闭，不能重试线下修订稿");
      }
      const comparison = await tx.contractDocumentComparison.findUnique({
        where: { offlineRevisionId: revision.id }
      });
      if (!comparison) throw new BadRequestException("线下修订稿比较记录异常，无法重试");
      await tx.contractDocumentDifference.deleteMany({
        where: { comparisonId: comparison.id }
      });
      const [revisionUpdated, comparisonUpdated] = await Promise.all([
        tx.contractOfflineRevision.updateMany({
          where: { id: revision.id, status: "failed" },
          data: {
            status: "queued",
            errorMessage: null,
            startedAt: null,
            completedAt: null
          }
        }),
        tx.contractDocumentComparison.updateMany({
          where: { id: comparison.id, status: "failed" },
          data: {
            status: "queued",
            algorithmVersion: null,
            baseNormalizedSha256: null,
            revisedNormalizedSha256: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null
          }
        })
      ]);
      if (revisionUpdated.count !== 1 || comparisonUpdated.count !== 1) {
        throw new BadRequestException("线下修订稿状态已变化，请刷新后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.offline_revision.retry",
        businessType: "contract_offline_revision",
        businessId: revision.id,
        metadata: { comparisonId: comparison.id, negotiationRoundId: round.id }
      });
      return {
        id: revision.id,
        status: "queued",
        label: revision.label,
        hasPreviewPdf: false,
        comparison: { id: comparison.id, status: "queued" }
      };
    });
  }

  private async loadOwnedVersion(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
    if (!version) throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只有合同经办人可以管理合同磋商和文档差异");
    }
    if (contract.voidedAt) throw new BadRequestException("合同草稿已作废，不能继续磋商");
    return { version, contract };
  }

  private async loadOwnedEditableVersionForUpdate(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const mutationBoundary =
      await lockContractDraftMutationBoundary<
        NonNullable<
          Awaited<ReturnType<typeof tx.contractVersion.findUnique>>
        >,
        NonNullable<
          Awaited<ReturnType<typeof tx.contract.findUnique>>
        >
      >(tx, contractVersionId);
    if (!mutationBoundary) {
      throw new NotFoundException(
        "未找到合同草稿版本，请刷新合同工作台后重试"
      );
    }
    const { version, contract } = mutationBoundary;
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException(
        "只有合同经办人可以管理合同磋商和文档差异"
      );
    }
    if (contract.voidedAt) {
      throw new BadRequestException("合同草稿已作废，不能继续磋商");
    }
    this.assertEditable(version.status);
    if (version.changeType === "historical_takeover") {
      throw new BadRequestException("历史接管草稿必须在历史接管工作台办理");
    }
    if (mutationBoundary.formalBlockers.length > 0) {
      throw new BadRequestException(
        "合同已存在正式业务事实，不能管理草稿磋商"
      );
    }
    return { version, contract };
  }

  private async lockRound(tx: Prisma.TransactionClient, roundId: string) {
    const [round] = await tx.$queryRaw<
      Array<{
        id: string;
        contractVersionId: string;
        roundNo: number;
        status: string;
        sourceGeneratedDocumentId: string;
        sourceRevision: number;
        note: string | null;
        openedAt: Date;
        closedAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        "id", "contractVersionId", "roundNo", "status",
        "sourceGeneratedDocumentId", "sourceRevision", "note", "openedAt", "closedAt"
      FROM "ContractNegotiationRound"
      WHERE "id" = ${roundId}
      FOR UPDATE
    `);
    return round ?? null;
  }

  private assertEditable(status: string) {
    if (!EDITABLE_VERSION_STATUSES.includes(status)) {
      throw new BadRequestException("合同草稿当前不可编辑，不能管理磋商轮次");
    }
  }

  private parseUploadInput(input: UploadNegotiationRevisionInput) {
    if (!input || typeof input !== "object") throw new BadRequestException("请填写线下修订稿信息");
    if (input.confirmationStatementAccepted !== true) {
      throw new BadRequestException("请先确认线下修订稿只作为草稿层依据，不作为审批或归档事实");
    }
    if (typeof input.fileId !== "string" || !input.fileId.trim()) {
      throw new BadRequestException("请选择线下修订稿文件");
    }
    if ("sourceGeneratedDocumentId" in input || "sourceRevision" in input) {
      throw new BadRequestException("线下修订稿来源由系统锁定，不能由客户端指定");
    }
    return {
      fileId: input.fileId.trim(),
      label: this.optionalText(input.label, 100, "线下修订稿名称") ?? "线下修订稿",
      note: this.optionalText(input.note, 1_000, "线下修订稿说明")
    };
  }

  private parseDispositionInput(input: DisposeContractDifferenceInput) {
    if (!input || typeof input !== "object" || !DISPOSITIONS.has(input.disposition)) {
      throw new BadRequestException("请选择有效的差异处置结果");
    }
    const reason = this.optionalText(input.reason, 1_000, "差异处置原因");
    if (input.disposition !== "confirmed" && !reason) {
      throw new BadRequestException("拒绝或标记无实质变化时必须填写原因");
    }
    return { disposition: input.disposition, reason };
  }

  private optionalText(value: unknown, maxLength: number, label: string) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${label}必须是文字`);
    const text = value.trim();
    if (!text) return null;
    if (text.length > maxLength) {
      throw new BadRequestException(`${label}不能超过 ${maxLength} 个字符`);
    }
    return text;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private isUniqueConflict(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }
}

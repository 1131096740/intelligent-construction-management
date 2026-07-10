import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import type {
  AttachContractTakeoverEvidenceDto,
  ContractTakeoverEvidencePurpose
} from "./dto/attach-contract-takeover-evidence.dto";
import type { ConfirmContractTakeoverDto } from "./dto/confirm-contract-takeover.dto";
import type {
  ContractLifecycleStatus,
  ContractTakeoverLevel,
  CreateContractTakeoverDto,
  UpdateContractTakeoverDto
} from "./dto/create-contract-takeover.dto";
import type { PrecheckContractTakeoverImportDto } from "./dto/precheck-contract-takeover-import.dto";
import type {
  ContractTakeoverImportBatchReviewStatus,
  ReviewContractTakeoverImportBatchDto
} from "./dto/review-contract-takeover-import-batch.dto";
import type {
  ContractTakeoverCorrectionType,
  RecordContractTakeoverCorrectionDto
} from "./dto/record-contract-takeover-correction.dto";

const TAKEOVER_LEVELS = ["A", "B", "C"] as const;
const LIFECYCLE_STATUSES = [
  "signed_not_started",
  "in_progress",
  "suspended",
  "completed",
  "terminated",
  "disputed"
] as const;
const EVIDENCE_PURPOSES = [
  "historical_contract_scan",
  "historical_settlement_ledger",
  "historical_payment_voucher",
  "other"
] as const satisfies readonly ContractTakeoverEvidencePurpose[];
const IMPORT_BATCH_REVIEW_STATUSES = [
  "under_review",
  "accepted",
  "limited_accepted",
  "disputed"
] as const satisfies readonly ContractTakeoverImportBatchReviewStatus[];
const IMPORT_BATCH_FINAL_STATUSES: readonly ContractTakeoverImportBatchReviewStatus[] = [
  "accepted",
  "limited_accepted",
  "disputed"
];
const TAKEOVER_CORRECTION_TYPES = [
  "amount",
  "payment_terms",
  "evidence",
  "other"
] as const satisfies readonly ContractTakeoverCorrectionType[];
const MONEY_FIELDS = [
  "historicalSettledCents",
  "historicalApprovalPendingPaymentCents",
  "historicalApprovedPendingPaymentCents",
  "historicalPaidCents",
  "historicalProxyPaidCents",
  "historicalAdvancePaidCents",
  "historicalAdvanceDeductedCents",
  "historicalRetentionWithheldCents",
  "historicalRetentionReleasedCents",
  "otherConfirmedOccupancyCents"
] as const satisfies readonly (keyof CreateContractTakeoverDto)[];
const MONEY_FIELD_LABELS: Record<(typeof MONEY_FIELDS)[number], string> = {
  historicalSettledCents: "历史累计结算",
  historicalApprovalPendingPaymentCents: "历史审批中付款",
  historicalApprovedPendingPaymentCents: "历史已批待付",
  historicalPaidCents: "历史累计已付",
  historicalProxyPaidCents: "历史总包代付",
  historicalAdvancePaidCents: "历史预付款已付",
  historicalAdvanceDeductedCents: "历史预付款已扣回",
  historicalRetentionWithheldCents: "历史质保金扣留",
  historicalRetentionReleasedCents: "历史质保金释放",
  otherConfirmedOccupancyCents: "其他确认占用"
};
const IMPORT_PRECHECK_MAX_ROWS = 200;

type TakeoverClient = Pick<Prisma.TransactionClient, "contractTakeover">;
type TakeoverReadClient = Pick<
  Prisma.TransactionClient,
  | "contract"
  | "contractVersion"
  | "paymentTermsVersion"
  | "contractTakeoverBatch"
  | "contractTakeoverCorrection"
  | "settlement"
  | "paymentRequest"
  | "paymentExecution"
  | "financeRecord"
  | "archiveRecord"
  | "fileObject"
  | "user"
>;

type ReadClientFindMany<T> = {
  findMany(args: unknown): Promise<T[]>;
};

type PostConfirmationSettlementRecord = {
  id: string;
  contractVersionId: string;
  sourceType: string;
  sourceTakeoverId: string | null;
  status: string;
};

type PostConfirmationPaymentRequestRecord = {
  id: string;
  contractVersionId: string;
  status: string;
};

type PostConfirmationPaymentExecutionRecord = {
  id: string;
  paymentRequestId: string;
};

type PostConfirmationFinanceRecord = {
  id: string;
  paymentRequestId: string | null;
};

type PostConfirmationVerificationStats = {
  newSettlementCount: number;
  paymentRequestCount: number;
  paymentExecutionCount: number;
  financeRecordCount: number;
};

type ContractTakeoverRecord = {
  id: string;
  projectId: string;
  takeoverBatchId?: string | null;
  importRowNo?: number | null;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  takeoverLevel: string;
  suggestedTakeoverLevel?: string | null;
  takeoverLevelAdjustmentReason?: string | null;
  takeoverStatus: string;
  lifecycleStatus: string;
  signedAt: Date;
  historicalSettledCents: bigint | number;
  historicalApprovalPendingPaymentCents: bigint | number;
  historicalApprovedPendingPaymentCents: bigint | number;
  historicalPaidCents: bigint | number;
  historicalProxyPaidCents: bigint | number;
  historicalAdvancePaidCents: bigint | number;
  historicalAdvanceDeductedCents: bigint | number;
  historicalRetentionWithheldCents: bigint | number;
  historicalRetentionReleasedCents: bigint | number;
  otherConfirmedOccupancyCents: bigint | number;
  balanceSourceSummary: string | null;
  evidenceSummary: string | null;
  takeoverCutoffDate: Date | null;
  responsibleUserId: string | null;
  reviewComment: string | null;
  acceptanceConclusion: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  historicalBalanceConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ContractTakeoverBusinessReadModel {
  id: string;
  batchNo: string | null;
  importRowNo: number | null;
  contractNo: string;
  contractName: string;
  counterparty: string;
  companyEntityName: string | null;
  amountCents: string;
  paymentTermsOriginalText: string;
  takeoverLevel: string;
  suggestedTakeoverLevel: string | null;
  takeoverLevelAdjustmentReason: string | null;
  levelRiskText: string;
  paymentBlockingHint: string;
  evidenceGapSummary: string;
  takeoverStatus: string;
  lifecycleStatus: string;
  signedAt: Date;
  historicalSettledCents: string;
  historicalApprovalPendingPaymentCents: string;
  historicalApprovedPendingPaymentCents: string;
  historicalPaidCents: string;
  historicalProxyPaidCents: string;
  historicalAdvancePaidCents: string;
  historicalAdvanceDeductedCents: string;
  historicalRetentionWithheldCents: string;
  historicalRetentionReleasedCents: string;
  otherConfirmedOccupancyCents: string;
  balanceSourceSummary: string | null;
  evidenceSummary: string | null;
  takeoverCutoffDate: Date | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  reviewComment: string | null;
  acceptanceConclusion: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  historicalBalanceConfirmedAt: Date | null;
  evidenceChecklist: ContractTakeoverEvidenceChecklistItemReadModel[];
  evidenceFiles: ContractTakeoverEvidenceFileReadModel[];
  corrections: ContractTakeoverCorrectionReadModel[];
  postConfirmationVerification: ContractTakeoverPostConfirmationVerificationReadModel;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContractTakeoverPostConfirmationVerificationReadModel {
  statusLabel: string;
  summaryText: string;
  newSettlementCount: number;
  paymentRequestCount: number;
  paymentExecutionCount: number;
  financeRecordCount: number;
}

export interface ContractTakeoverEvidenceChecklistItemReadModel {
  purpose: ContractTakeoverEvidencePurpose;
  purposeLabel: string;
  required: boolean;
  uploaded: boolean;
  statusLabel: string;
  riskText: string;
}

export interface ContractTakeoverEvidenceFileReadModel {
  recordId: string;
  fileId: string;
  fileName: string;
  purpose: ContractTakeoverEvidencePurpose;
  purposeLabel: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string;
  uploadedAt: Date;
  canDownload: boolean;
  disabledReason: string | null;
}

export interface ContractTakeoverCorrectionReadModel {
  id: string;
  correctionType: string;
  correctionTypeLabel: string;
  reason: string;
  beforeSummary: string;
  afterSummary: string;
  responsibleUserName: string;
  createdByName: string;
  attachmentFileId: string;
  attachmentFileName: string;
  createdAt: Date;
}

export type ContractTakeoverImportPrecheckIssueLevel = "error" | "warning";
export type ContractTakeoverImportPrecheckStatus = "ready" | "blocked";

export interface ContractTakeoverImportPrecheckIssue {
  rowNo: number;
  field: string;
  level: ContractTakeoverImportPrecheckIssueLevel;
  message: string;
}

export interface ContractTakeoverImportPrecheckRow {
  rowNo: number;
  code: string;
  name: string;
  counterparty: string;
  amountCents: number | null;
  takeoverLevel: string;
  lifecycleStatus: string;
  evidenceChecklist: string;
  issueSummary: string;
  status: ContractTakeoverImportPrecheckStatus;
  issues: ContractTakeoverImportPrecheckIssue[];
}

export interface ContractTakeoverImportPrecheckResult {
  projectId: string;
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  warningRows: number;
  existingCodes: string[];
  duplicatedCodes: string[];
  rows: ContractTakeoverImportPrecheckRow[];
}

export interface ContractTakeoverImportDraftResult {
  projectId: string;
  batch: ContractTakeoverImportBatchReadModel;
  createdCount: number;
  skippedCount: number;
  createdRows: number[];
  created: ContractTakeoverBusinessReadModel[];
}

export interface ContractTakeoverImportBatchReadModel {
  id: string;
  batchNo: string;
  status: string;
  statusLabel: string;
  riskText: string;
  takeoverCutoffDate: Date;
  responsibleUserId: string;
  responsibleUserName: string | null;
  reviewComment: string;
  acceptanceConclusion: string;
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  warningRows: number;
  createdCount: number;
  skippedCount: number;
}

interface CreateDraftRecordOptions {
  takeoverBatchId?: string;
  importRowNo?: number;
}

@Injectable()
export class ContractTakeoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly files?: FileService
  ) {}

  async create(projectId: string, input: CreateContractTakeoverDto, actorUserId: string) {
    const data = this.normalizeCreateInput(input);

    return this.prisma.$transaction((tx) =>
      this.createDraftRecord(tx, projectId, data, actorUserId)
    );
  }

  private async createDraftRecord(
    tx: Prisma.TransactionClient,
    projectId: string,
    data: ReturnType<ContractTakeoverService["normalizeCreateInput"]>,
    actorUserId: string,
    options: CreateDraftRecordOptions = {}
  ) {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, isActive: true }
    });
    if (!project?.isActive) {
      throw new Error("项目不存在或已停用，请重新选择项目");
    }

      const contract = await tx.contract.create({
        data: {
          projectId,
          source: "historical_takeover",
          code: data.code,
          name: data.name,
          counterparty: data.counterparty,
          companyEntityId: data.companyEntityId ?? null,
          companyEntityName: data.companyEntityName ?? null,
          contractTypeKey: data.contractTypeKey ?? null,
          ownerUserId: actorUserId
        }
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "historical_takeover",
          status: "draft",
          amountCents: BigInt(data.amountCents),
          draftData: { historicalTakeover: true } as Prisma.InputJsonValue,
          templateSnapshot: { historicalTakeover: true } as Prisma.InputJsonValue,
          clauseSnapshot: [] as Prisma.InputJsonValue
        }
      });

      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: data.paymentTermsOriginalText ?? ""
        }
      });
      await tx.paymentTermsStage.createMany({
        data: [this.takeoverInitialSettlementStage(terms.id, data.paymentTermsOriginalText)]
      });

      const takeover = await tx.contractTakeover.create({
        data: {
          projectId,
          contractId: contract.id,
          contractVersionId: version.id,
          paymentTermsVersionId: terms.id,
          takeoverLevel: data.takeoverLevel,
          suggestedTakeoverLevel: data.suggestedTakeoverLevel,
          takeoverLevelAdjustmentReason:
            data.takeoverLevel === data.suggestedTakeoverLevel ? null : data.reviewComment,
          takeoverStatus: "draft",
          takeoverBatchId: options.takeoverBatchId,
          importRowNo: options.importRowNo,
          lifecycleStatus: data.lifecycleStatus,
          signedAt: data.signedAt,
          historicalSettledCents: BigInt(data.historicalSettledCents),
          historicalApprovalPendingPaymentCents: BigInt(data.historicalApprovalPendingPaymentCents),
          historicalApprovedPendingPaymentCents: BigInt(data.historicalApprovedPendingPaymentCents),
          historicalPaidCents: BigInt(data.historicalPaidCents),
          historicalProxyPaidCents: BigInt(data.historicalProxyPaidCents),
          historicalAdvancePaidCents: BigInt(data.historicalAdvancePaidCents),
          historicalAdvanceDeductedCents: BigInt(data.historicalAdvanceDeductedCents),
          historicalRetentionWithheldCents: BigInt(data.historicalRetentionWithheldCents),
          historicalRetentionReleasedCents: BigInt(data.historicalRetentionReleasedCents),
          otherConfirmedOccupancyCents: BigInt(data.otherConfirmedOccupancyCents),
          balanceSourceSummary: data.balanceSourceSummary ?? null,
          evidenceSummary: data.evidenceSummary ?? null,
          takeoverCutoffDate: data.takeoverCutoffDate,
          responsibleUserId: data.responsibleUserId,
          reviewComment: data.reviewComment,
          acceptanceConclusion: data.acceptanceConclusion,
          createdByUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.create",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: contract.id,
          contractVersionId: version.id,
          takeoverLevel: data.takeoverLevel,
          suggestedTakeoverLevel: data.suggestedTakeoverLevel,
          takeoverLevelAdjustmentReason:
            data.takeoverLevel === data.suggestedTakeoverLevel ? null : data.reviewComment,
          takeoverBatchId: options.takeoverBatchId ?? null,
          importRowNo: options.importRowNo ?? null
        }
      });

      return this.toReadModel(takeover, {
        contractNo: data.code,
        contractName: data.name,
        counterparty: data.counterparty,
        companyEntityName: data.companyEntityName ?? null,
        amountCents: data.amountCents,
        paymentTermsOriginalText: data.paymentTermsOriginalText ?? "",
        evidenceFiles: [],
        corrections: [],
        postConfirmationVerification: postConfirmationVerificationReadModel(
          takeover,
          emptyPostConfirmationVerificationStats()
        )
      });
  }

  async updateDraft(
    projectId: string,
    takeoverId: string,
    input: UpdateContractTakeoverDto,
    actorUserId: string
  ) {
    const data = this.normalizeCreateInput(input);

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (!["draft", "needs_supplement"].includes(takeover.takeoverStatus)) {
        throw new Error("当前接管记录不能编辑，请确认仍处于草稿或待补充状态");
      }

      await tx.contract.update({
        where: { id: takeover.contractId },
        data: {
          code: data.code,
          name: data.name,
          counterparty: data.counterparty,
          companyEntityId: data.companyEntityId ?? null,
          companyEntityName: data.companyEntityName ?? null,
          contractTypeKey: data.contractTypeKey ?? null
        }
      });
      await tx.contractVersion.update({
        where: { id: takeover.contractVersionId },
        data: { amountCents: BigInt(data.amountCents) }
      });
      await tx.paymentTermsVersion.update({
        where: { id: takeover.paymentTermsVersionId },
        data: { originalText: data.paymentTermsOriginalText ?? "" }
      });
      await tx.paymentTermsStage.deleteMany({
        where: { paymentTermsVersionId: takeover.paymentTermsVersionId }
      });
      await tx.paymentTermsStage.createMany({
        data: [
          this.takeoverInitialSettlementStage(
            takeover.paymentTermsVersionId,
            data.paymentTermsOriginalText
          )
        ]
      });
      const updated = await tx.contractTakeover.update({
        where: { id: takeover.id },
        data: {
          takeoverLevel: data.takeoverLevel,
          lifecycleStatus: data.lifecycleStatus,
          signedAt: data.signedAt,
          historicalSettledCents: BigInt(data.historicalSettledCents),
          historicalApprovalPendingPaymentCents: BigInt(data.historicalApprovalPendingPaymentCents),
          historicalApprovedPendingPaymentCents: BigInt(data.historicalApprovedPendingPaymentCents),
          historicalPaidCents: BigInt(data.historicalPaidCents),
          historicalProxyPaidCents: BigInt(data.historicalProxyPaidCents),
          historicalAdvancePaidCents: BigInt(data.historicalAdvancePaidCents),
          historicalAdvanceDeductedCents: BigInt(data.historicalAdvanceDeductedCents),
          historicalRetentionWithheldCents: BigInt(data.historicalRetentionWithheldCents),
          historicalRetentionReleasedCents: BigInt(data.historicalRetentionReleasedCents),
          otherConfirmedOccupancyCents: BigInt(data.otherConfirmedOccupancyCents),
          balanceSourceSummary: data.balanceSourceSummary ?? null,
          evidenceSummary: data.evidenceSummary ?? null,
          suggestedTakeoverLevel: data.suggestedTakeoverLevel,
          takeoverLevelAdjustmentReason:
            data.takeoverLevel === data.suggestedTakeoverLevel ? null : data.reviewComment,
          takeoverCutoffDate: data.takeoverCutoffDate,
          responsibleUserId: data.responsibleUserId,
          reviewComment: data.reviewComment,
          acceptanceConclusion: data.acceptanceConclusion
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.update_draft",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: takeover.contractId,
          contractVersionId: takeover.contractVersionId,
          fromStatus: takeover.takeoverStatus,
          fromTakeoverLevel: takeover.takeoverLevel,
          toTakeoverLevel: data.takeoverLevel,
          suggestedTakeoverLevel: data.suggestedTakeoverLevel,
          takeoverLevelAdjustmentReason:
            data.takeoverLevel === data.suggestedTakeoverLevel ? null : data.reviewComment
        }
      });

      return this.toReadModel(updated, {
        contractNo: data.code,
        contractName: data.name,
        counterparty: data.counterparty,
        companyEntityName: data.companyEntityName ?? null,
        amountCents: data.amountCents,
        paymentTermsOriginalText: data.paymentTermsOriginalText ?? "",
        evidenceFiles: [],
        corrections: [],
        postConfirmationVerification: postConfirmationVerificationReadModel(
          updated,
          emptyPostConfirmationVerificationStats()
        )
      });
    });
  }

  async attachEvidenceFile(
    projectId: string,
    takeoverId: string,
    input: AttachContractTakeoverEvidenceDto,
    actorUserId: string
  ) {
    const fileId = input.fileId?.trim();
    if (!fileId) {
      throw new Error("请先选择要挂接的接管资料文件");
    }
    if (!EVIDENCE_PURPOSES.includes(input.purpose)) {
      throw new Error("接管资料类型不正确，请重新选择资料类型");
    }

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (!["draft", "needs_supplement"].includes(takeover.takeoverStatus)) {
        if (takeover.takeoverStatus === "confirmed") {
          throw new Error(
            "已完成主管确认，接管资料不能静默补充，请发起更正记录并保留原因、责任人和附件"
          );
        }
        throw new Error("当前接管记录不能继续挂接资料，请确认仍处于草稿或待补充状态");
      }
      if (!this.files) {
        throw new Error("系统暂不能读取接管资料文件，请稍后重试");
      }
      try {
        await this.files.assertCanDownloadFile(tx, fileId, actorUserId);
      } catch {
        throw new Error("当前账号无权读取该接管资料文件");
      }

      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "contract_takeover",
          businessId: takeover.id,
          fileId,
          departmentScope: input.purpose
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.evidence.attach",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          fileId,
          archiveRecordId: archiveRecord.id,
          purpose: input.purpose
        }
      });

      return this.toReadModelFromDatabase(tx, takeover);
    });
  }

  async recordCorrection(
    projectId: string,
    takeoverId: string,
    input: RecordContractTakeoverCorrectionDto,
    actorUserId: string
  ) {
    const correctionType = input.correctionType?.trim() as ContractTakeoverCorrectionType;
    if (!TAKEOVER_CORRECTION_TYPES.includes(correctionType)) {
      throw new Error("更正类型不正确，请重新选择更正事项");
    }
    const reason = input.reason?.trim();
    if (!reason) throw new Error("请填写更正原因");
    const responsibleUserId = input.responsibleUserId?.trim();
    if (!responsibleUserId) throw new Error("请填写更正责任人");
    const afterSummary = input.afterSummary?.trim();
    if (!afterSummary) throw new Error("请填写更正后的事实说明");
    const attachmentFileId = input.attachmentFileId?.trim();
    if (!attachmentFileId) throw new Error("请上传更正依据附件");
    const currentPassword = input.currentPassword?.trim();
    if (!currentPassword) throw new Error("请填写当前登录密码后再保存接管更正记录");
    if (!this.auth) {
      throw new Error("系统暂不能确认当前密码，请稍后重试");
    }
    await this.auth.confirmPassword(actorUserId, currentPassword);

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (takeover.takeoverStatus !== "confirmed") {
        throw new Error("接管尚未主管确认，请直接在草稿或待补充阶段修改资料");
      }
      if (!this.files) {
        throw new Error("系统暂不能读取更正依据附件，请稍后重试");
      }
      try {
        await this.files.assertCanDownloadFile(tx, attachmentFileId, actorUserId);
      } catch {
        throw new Error("当前账号无权读取更正依据附件");
      }

      const correction = await tx.contractTakeoverCorrection.create({
        data: {
          projectId,
          takeoverId: takeover.id,
          correctionType,
          beforeSnapshot: this.toCorrectionBeforeSnapshot(takeover),
          afterSnapshot: { summary: afterSummary },
          reason,
          responsibleUserId,
          attachmentFileId,
          createdByUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.correction.record",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          correctionId: correction.id,
          correctionType,
          attachmentFileId,
          responsibleUserId
        }
      });

      return {
        id: correction.id,
        message: "接管更正记录已保存，后续复核可查看原因、责任人和附件"
      };
    });
  }

  async list(projectId: string) {
    const takeovers = await this.prisma.contractTakeover.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" }
    });

    return this.toReadModels(this.prisma, takeovers);
  }

  async listImportBatches(projectId: string) {
    const batches = await this.prisma.contractTakeoverBatch.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" }
    });
    const responsibleUserIds = unique(batches.map((batch) => batch.responsibleUserId));
    const users = responsibleUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: responsibleUserIds } },
          select: { id: true, name: true }
        })
      : [];
    const userNameById = new Map(users.map((user) => [user.id, user.name]));

    return batches.map((batch) =>
      this.toImportBatchReadModel({
        ...batch,
        responsibleUserName: userNameById.get(batch.responsibleUserId) ?? null
      })
    );
  }

  async reviewImportBatch(
    projectId: string,
    batchId: string,
    input: ReviewContractTakeoverImportBatchDto,
    actorUserId: string
  ) {
    const status = input.status;
    if (!IMPORT_BATCH_REVIEW_STATUSES.includes(status)) {
      throw new Error("请选择正确的接管批次复核结果");
    }
    const reviewComment = input.reviewComment?.trim();
    if (!reviewComment) throw new Error("请填写批次复核意见后再提交复核结果");
    const acceptanceConclusion = input.acceptanceConclusion?.trim();
    if (!acceptanceConclusion) throw new Error("请填写批次验收结论后再提交复核结果");

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.contractTakeoverBatch.findFirst({
        where: { id: batchId, projectId }
      });
      if (!batch) {
        throw new Error("接管批次不存在，请刷新接管工作台后重试");
      }
      if (!canMoveImportBatchStatus(batch.status, status)) {
        throw new Error(
          `当前批次为“${importBatchStatusLabel(batch.status)}”，不能直接变更为“${importBatchStatusLabel(status)}”`
        );
      }

      const updated = await tx.contractTakeoverBatch.update({
        where: { id: batch.id },
        data: { status, reviewComment, acceptanceConclusion }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover_batch.review",
        businessType: "contract_takeover_batch",
        businessId: batch.id,
        metadata: {
          projectId,
          batchNo: batch.batchNo,
          fromStatus: batch.status,
          toStatus: status
        }
      });

      return this.toImportBatchReadModel(updated);
    });
  }

  async detail(projectId: string, takeoverId: string) {
    const takeover = await this.getProjectTakeover(this.prisma, projectId, takeoverId);
    return this.toReadModelFromDatabase(this.prisma, takeover);
  }

  async precheckImport(
    projectId: string,
    input: PrecheckContractTakeoverImportDto
  ): Promise<ContractTakeoverImportPrecheckResult> {
    const rows = this.parsePrecheckRows(input);
    const normalizedCodes = unique(
      rows
        .map((row) => stringValue(row["code"]))
        .filter((code): code is string => Boolean(code))
    );
    const existingContracts = normalizedCodes.length
      ? await this.prisma.contract.findMany({
          where: {
            OR: [{ code: { in: normalizedCodes } }, { temporaryCode: { in: normalizedCodes } }]
          },
          select: { code: true, temporaryCode: true }
        })
      : [];
    const existingCodes = new Set(
      existingContracts.flatMap((contract) =>
        [contract.code, contract.temporaryCode].filter(
          (code): code is string => typeof code === "string" && normalizedCodes.includes(code)
        )
      )
    );
    const duplicatedCodes = new Set(
      normalizedCodes.filter(
        (code) => rows.filter((row) => stringValue(row["code"]) === code).length > 1
      )
    );

    const checkedRows = rows.map((row, index) =>
      this.precheckImportRow(row, index + 1, existingCodes, duplicatedCodes)
    );

    return {
      projectId,
      totalRows: checkedRows.length,
      readyRows: checkedRows.filter((row) => row.status === "ready").length,
      blockedRows: checkedRows.filter((row) => row.status === "blocked").length,
      warningRows: checkedRows.filter((row) =>
        row.issues.some((issue) => issue.level === "warning")
      ).length,
      existingCodes: [...existingCodes].sort(),
      duplicatedCodes: [...duplicatedCodes].sort(),
      rows: checkedRows
    };
  }

  async createDraftsFromImport(
    projectId: string,
    input: PrecheckContractTakeoverImportDto,
    actorUserId: string
  ): Promise<ContractTakeoverImportDraftResult> {
    const precheck = await this.precheckImport(projectId, input);
    if (precheck.blockedRows > 0) {
      throw new Error("导入预检仍有错误行，请先修正后再生成接管草稿");
    }
    const rows = this.parsePrecheckRows(input);
    const readyRowNos = new Set(precheck.rows.map((row) => row.rowNo));
    const readyRows = rows.filter((row, index) =>
      readyRowNos.has(integerOrFallback(row["rowNo"], index + 1))
    );
    if (!readyRows.length) {
      throw new Error("没有可生成接管草稿的导入行");
    }

    const readyRowsWithRowNo = readyRows.map((row, index) => ({
      row,
      rowNo: integerOrFallback(row["rowNo"], index + 1)
    }));
    const batchInputForFingerprint = this.normalizeImportBatchInput(input);
    const importFingerprint = this.importFingerprint(
      readyRowsWithRowNo.map(({ row }) => row),
      batchInputForFingerprint
    );
    const batchInput = {
      ...batchInputForFingerprint,
      batchNo: input.batchNo?.trim() || this.defaultImportBatchNo(importFingerprint)
    };

    return this.prisma.$transaction(async (tx) => {
      const existingBatch = await tx.contractTakeoverBatch.findUnique({
        where: { projectId_importFingerprint: { projectId, importFingerprint } }
      });
      if (existingBatch) {
        const existingTakeovers = await tx.contractTakeover.findMany({
          where: { takeoverBatchId: existingBatch.id },
          orderBy: { importRowNo: "asc" }
        });
        const created = await this.toReadModels(tx, existingTakeovers);
        return {
          projectId,
          batch: this.toImportBatchReadModel(existingBatch),
          createdCount: 0,
          skippedCount: existingTakeovers.length,
          createdRows: existingTakeovers
            .map((takeover) => takeover.importRowNo)
            .filter((rowNo): rowNo is number => typeof rowNo === "number"),
          created
        };
      }

      const batch = await tx.contractTakeoverBatch.create({
        data: {
          projectId,
          batchNo: batchInput.batchNo,
          status: "drafts_generated",
          takeoverCutoffDate: batchInput.takeoverCutoffDate,
          responsibleUserId: batchInput.responsibleUserId,
          reviewComment: batchInput.reviewComment,
          acceptanceConclusion: batchInput.acceptanceConclusion,
          importFingerprint,
          totalRows: precheck.totalRows,
          readyRows: precheck.readyRows,
          blockedRows: precheck.blockedRows,
          warningRows: precheck.warningRows,
          createdCount: readyRowsWithRowNo.length,
          skippedCount: 0,
          createdByUserId: actorUserId
        }
      });

      const created: ContractTakeoverBusinessReadModel[] = [];
      for (const { row, rowNo } of readyRowsWithRowNo) {
        const draft = await this.createDraftRecord(
          tx,
          projectId,
          this.normalizeCreateInput({
            ...this.importRowToCreateInput(row),
            takeoverCutoffDate: stringValue(row["takeoverCutoffDate"]) || input.takeoverCutoffDate,
            responsibleUserId: stringValue(row["responsibleUserId"]) || batch.responsibleUserId,
            reviewComment:
              stringValue(row["reviewComment"]) || stringValue(row["issueSummary"]) || batch.reviewComment,
            acceptanceConclusion:
              stringValue(row["acceptanceConclusion"]) || batch.acceptanceConclusion
          }),
          actorUserId,
          { takeoverBatchId: batch.id, importRowNo: rowNo }
        );
        created.push({ ...draft, batchNo: batch.batchNo, importRowNo: rowNo });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.import_drafts",
        businessType: "contract_takeover_batch",
        businessId: batch.id,
        metadata: {
          projectId,
          batchNo: batch.batchNo,
          createdCount: created.length,
          readyRows: precheck.readyRows,
          warningRows: precheck.warningRows
        }
      });

      return {
        projectId,
        batch: this.toImportBatchReadModel(batch),
        createdCount: created.length,
        skippedCount: 0,
        createdRows: readyRowsWithRowNo.map(({ rowNo }) => rowNo),
        created
      };
    });
  }

  async submitReview(projectId: string, takeoverId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (!["draft", "needs_supplement"].includes(takeover.takeoverStatus)) {
        throw new Error("当前接管记录不能提交复核，请确认仍处于草稿或待补充状态");
      }

      const submittedAt = new Date();
      const updated = await tx.contractTakeover.update({
        where: { id: takeover.id },
        data: {
          takeoverStatus: "pending_review",
          submittedByUserId: actorUserId,
          submittedAt
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.submit_review",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: takeover.contractId,
          contractVersionId: takeover.contractVersionId,
          fromStatus: takeover.takeoverStatus,
          toStatus: "pending_review"
        }
      });

      return this.toReadModelFromDatabase(tx, updated);
    });
  }

  async confirm(
    projectId: string,
    takeoverId: string,
    actorUserId: string,
    input: ConfirmContractTakeoverDto
  ) {
    if (!input.confirmationPassword?.trim()) {
      throw new Error("确认历史合同接管需要当前登录密码");
    }
    if (!this.auth) {
      throw new Error("系统暂不能确认当前密码，请稍后重试");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (takeover.takeoverStatus !== "pending_review") {
        throw new Error("当前接管记录尚不能确认，请先提交复核并完成资料核验");
      }
      const [takeoverReadModel] = await this.toReadModels(tx, [takeover]);
      const missingEvidenceLabels = takeoverReadModel.evidenceChecklist
        .filter((item) => item.required && !item.uploaded)
        .map((item) => item.purposeLabel);
      if (missingEvidenceLabels.length) {
        throw new Error(
          `接管资料未补齐：${missingEvidenceLabels.join("、")}。请先补齐资料后再确认接管。`
        );
      }

      const confirmedAt = new Date();
      await tx.contractVersion.update({
        where: { id: takeover.contractVersionId },
        data: { status: "effective", effectiveAt: confirmedAt }
      });
      await tx.paymentTermsVersion.update({
        where: { id: takeover.paymentTermsVersionId },
        data: { status: "effective" }
      });
      await this.createHistoricalInitialSettlement(tx, takeover);
      const updated = await tx.contractTakeover.update({
        where: { id: takeover.id },
        data: {
          takeoverStatus: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt,
          historicalBalanceConfirmedByUserId: actorUserId,
          historicalBalanceConfirmedAt: confirmedAt
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.confirm",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: takeover.contractId,
          contractVersionId: takeover.contractVersionId,
          fromStatus: takeover.takeoverStatus,
          toStatus: "confirmed"
        }
      });

      return this.toReadModelFromDatabase(tx, updated);
    });
  }

  private async getProjectTakeover(
    client: TakeoverClient,
    projectId: string,
    takeoverId: string
  ) {
    const takeover = await client.contractTakeover.findUnique({
      where: { id: takeoverId }
    });
    if (!takeover || takeover.projectId !== projectId) {
      throw new Error("未找到历史合同接管记录，请刷新接管工作台后重试");
    }

    return takeover;
  }

  private async toReadModels(
    client: TakeoverReadClient,
    takeovers: ContractTakeoverRecord[]
  ): Promise<ContractTakeoverBusinessReadModel[]> {
    if (!takeovers.length) {
      return [];
    }

    const contractIds = unique(takeovers.map((takeover) => takeover.contractId));
    const takeoverIds = unique(takeovers.map((takeover) => takeover.id));
    const contractVersionIds = unique(takeovers.map((takeover) => takeover.contractVersionId));
    const paymentTermsClient = (client as unknown as {
      paymentTermsVersion?: TakeoverReadClient["paymentTermsVersion"];
    }).paymentTermsVersion;
    const archiveClient = (client as unknown as {
      archiveRecord?: TakeoverReadClient["archiveRecord"];
      fileObject?: TakeoverReadClient["fileObject"];
      user?: TakeoverReadClient["user"];
    });
    const batchClient = (client as unknown as {
      contractTakeoverBatch?: TakeoverReadClient["contractTakeoverBatch"];
    }).contractTakeoverBatch;
    const correctionClient = (client as unknown as {
      contractTakeoverCorrection?: TakeoverReadClient["contractTakeoverCorrection"];
    }).contractTakeoverCorrection;
    const verificationClient = client as unknown as {
      settlement?: ReadClientFindMany<PostConfirmationSettlementRecord>;
      paymentRequest?: ReadClientFindMany<PostConfirmationPaymentRequestRecord>;
      paymentExecution?: ReadClientFindMany<PostConfirmationPaymentExecutionRecord>;
      financeRecord?: ReadClientFindMany<PostConfirmationFinanceRecord>;
    };
    const paymentTermsVersionIds = unique(takeovers.map((takeover) => takeover.paymentTermsVersionId));
    const batchIds = unique(
      takeovers
        .map((takeover) => takeover.takeoverBatchId)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    );
    const [contracts, versions, terms, batches, archiveRecords, correctionRecords] = await Promise.all([
      client.contract.findMany({
        where: { id: { in: contractIds } },
        select: {
          id: true,
          code: true,
          temporaryCode: true,
          name: true,
          counterparty: true,
          companyEntityName: true
        }
      }),
      client.contractVersion.findMany({
        where: { id: { in: contractVersionIds } },
        select: { id: true, amountCents: true }
      }),
      typeof paymentTermsClient?.findMany === "function"
        ? paymentTermsClient.findMany({
            where: { id: { in: paymentTermsVersionIds } },
            select: { id: true, originalText: true }
          })
        : Promise.resolve([]),
      typeof batchClient?.findMany === "function" && batchIds.length
        ? batchClient.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, batchNo: true }
          })
        : Promise.resolve([]),
      typeof archiveClient.archiveRecord?.findMany === "function"
        ? archiveClient.archiveRecord.findMany({
            where: { businessType: "contract_takeover", businessId: { in: takeoverIds } },
            orderBy: { createdAt: "desc" }
          })
        : Promise.resolve([]),
      typeof correctionClient?.findMany === "function"
        ? correctionClient.findMany({
            where: { takeoverId: { in: takeoverIds } },
            orderBy: { createdAt: "desc" }
          })
        : Promise.resolve([])
    ]);
    const responsibleUserIds = unique(
      takeovers
        .map((takeover) => takeover.responsibleUserId)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    );
    const evidenceFileIds = unique(archiveRecords.map((record) => record.fileId));
    const correctionFileIds = unique(correctionRecords.map((record) => record.attachmentFileId));
    const fileIds = unique([...evidenceFileIds, ...correctionFileIds]);
    const files = typeof archiveClient.fileObject?.findMany === "function" && fileIds.length
      ? await archiveClient.fileObject.findMany({ where: { id: { in: fileIds } } })
      : [];
    const [postConfirmationSettlements, postConfirmationPaymentRequests] = await Promise.all([
      typeof verificationClient.settlement?.findMany === "function"
        ? verificationClient.settlement.findMany({
            where: { contractVersionId: { in: contractVersionIds } },
            select: {
              id: true,
              contractVersionId: true,
              sourceType: true,
              sourceTakeoverId: true,
              status: true
            }
          })
        : Promise.resolve([]),
      typeof verificationClient.paymentRequest?.findMany === "function"
        ? verificationClient.paymentRequest.findMany({
            where: { contractVersionId: { in: contractVersionIds } },
            select: { id: true, contractVersionId: true, status: true }
          })
        : Promise.resolve([])
    ]);
    const activePostConfirmationPaymentRequests = postConfirmationPaymentRequests.filter(
      (request) => !isInactiveBusinessStatus(request.status)
    );
    const paymentRequestIds = unique(activePostConfirmationPaymentRequests.map((request) => request.id));
    const [postConfirmationPaymentExecutions, postConfirmationFinanceRecords] =
      paymentRequestIds.length
        ? await Promise.all([
            typeof verificationClient.paymentExecution?.findMany === "function"
              ? verificationClient.paymentExecution.findMany({
                  where: { paymentRequestId: { in: paymentRequestIds } },
                  select: { id: true, paymentRequestId: true }
                })
              : Promise.resolve([]),
            typeof verificationClient.financeRecord?.findMany === "function"
              ? verificationClient.financeRecord.findMany({
                  where: { paymentRequestId: { in: paymentRequestIds } },
                  select: { id: true, paymentRequestId: true }
                })
              : Promise.resolve([])
          ])
        : [[], []];
    const correctionUserIds = unique(
      correctionRecords.flatMap((record) => [record.responsibleUserId, record.createdByUserId])
    );
    const userIds = unique([
      ...files.map((file) => file.uploadedByUserId),
      ...responsibleUserIds,
      ...correctionUserIds
    ]);
    const users = typeof archiveClient.user?.findMany === "function" && userIds.length
      ? await archiveClient.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true }
        })
      : [];

    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const termsById = new Map(terms.map((term) => [term.id, term]));
    const batchById = new Map(batches.map((batch) => [batch.id, batch]));
    const fileById = new Map(files.map((file) => [file.id, file]));
    const userNameById = new Map(users.map((user) => [user.id, user.name]));
    const recordsByTakeoverId = new Map<string, typeof archiveRecords>();
    for (const record of archiveRecords) {
      recordsByTakeoverId.set(record.businessId, [
        ...(recordsByTakeoverId.get(record.businessId) ?? []),
        record
      ]);
    }
    const correctionsByTakeoverId = new Map<string, typeof correctionRecords>();
    for (const correction of correctionRecords) {
      correctionsByTakeoverId.set(correction.takeoverId, [
        ...(correctionsByTakeoverId.get(correction.takeoverId) ?? []),
        correction
      ]);
    }
    const postConfirmationVerificationByVersionId = postConfirmationVerificationStatsByVersion(
      postConfirmationSettlements,
      activePostConfirmationPaymentRequests,
      postConfirmationPaymentExecutions,
      postConfirmationFinanceRecords
    );

    return takeovers.map((takeover) =>
      this.toReadModel(takeover, {
        contractNo:
          contractById.get(takeover.contractId)?.code ??
          contractById.get(takeover.contractId)?.temporaryCode ??
          takeover.id,
        contractName: contractById.get(takeover.contractId)?.name ?? "未读取合同名称",
        counterparty: contractById.get(takeover.contractId)?.counterparty ?? "未读取相对方",
        companyEntityName: contractById.get(takeover.contractId)?.companyEntityName ?? null,
        amountCents: versionById.get(takeover.contractVersionId)?.amountCents ?? 0,
        paymentTermsOriginalText: termsById.get(takeover.paymentTermsVersionId)?.originalText ?? "",
        batchNo: takeover.takeoverBatchId
          ? batchById.get(takeover.takeoverBatchId)?.batchNo ?? null
          : null,
        responsibleUserName: takeover.responsibleUserId
          ? userNameById.get(takeover.responsibleUserId) ?? null
          : null,
        evidenceFiles: (recordsByTakeoverId.get(takeover.id) ?? []).flatMap((record) => {
          const file = fileById.get(record.fileId);
          if (!file) {
            return [];
          }

          return [
            {
              recordId: record.id,
              fileId: file.id,
              fileName: file.originalName,
              purpose: evidencePurpose(record.departmentScope),
              purposeLabel: evidencePurposeLabel(evidencePurpose(record.departmentScope)),
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              uploadedByName: userNameById.get(file.uploadedByUserId) ?? "上传人未读取",
              uploadedAt: file.createdAt,
              canDownload: true,
              disabledReason: null
            }
          ];
        }),
        corrections: (correctionsByTakeoverId.get(takeover.id) ?? []).map((correction) => {
          const attachment = fileById.get(correction.attachmentFileId);
          return {
            id: correction.id,
            correctionType: correction.correctionType,
            correctionTypeLabel: correctionTypeLabel(correction.correctionType),
            reason: correction.reason,
            beforeSummary: correctionBeforeSummary(correction.beforeSnapshot),
            afterSummary: correctionAfterSummary(correction.afterSnapshot),
            responsibleUserName:
              userNameById.get(correction.responsibleUserId) ?? "更正责任人未读取",
            createdByName: userNameById.get(correction.createdByUserId) ?? "更正记录人未读取",
            attachmentFileId: correction.attachmentFileId,
            attachmentFileName: attachment?.originalName ?? "更正依据附件未读取",
            createdAt: correction.createdAt
          };
        }),
        postConfirmationVerification: postConfirmationVerificationReadModel(
          takeover,
          postConfirmationVerificationByVersionId.get(takeover.contractVersionId) ??
            emptyPostConfirmationVerificationStats()
        )
      })
    );
  }

  private async toReadModelFromDatabase(
    client: TakeoverReadClient,
    takeover: ContractTakeoverRecord
  ) {
    const [readModel] = await this.toReadModels(client, [takeover]);
    return readModel;
  }

  private toReadModel(
    takeover: ContractTakeoverRecord,
    contract: {
      contractNo: string;
      contractName: string;
      counterparty: string;
      companyEntityName: string | null;
      amountCents: bigint | number;
      paymentTermsOriginalText: string;
      batchNo?: string | null;
      responsibleUserName?: string | null;
      evidenceFiles: ContractTakeoverEvidenceFileReadModel[];
      corrections: ContractTakeoverCorrectionReadModel[];
      postConfirmationVerification: ContractTakeoverPostConfirmationVerificationReadModel;
    }
  ): ContractTakeoverBusinessReadModel {
    const evidenceChecklist = takeoverEvidenceChecklist(takeover, contract.evidenceFiles);

    return {
      id: takeover.id,
      batchNo: contract.batchNo ?? null,
      importRowNo: takeover.importRowNo ?? null,
      contractNo: contract.contractNo,
      contractName: contract.contractName,
      counterparty: contract.counterparty,
      companyEntityName: contract.companyEntityName,
      amountCents: moneyString(contract.amountCents),
      paymentTermsOriginalText: contract.paymentTermsOriginalText,
      takeoverLevel: takeover.takeoverLevel,
      suggestedTakeoverLevel: takeover.suggestedTakeoverLevel ?? null,
      takeoverLevelAdjustmentReason: takeover.takeoverLevelAdjustmentReason ?? null,
      levelRiskText: takeoverLevelRiskText(takeover.takeoverLevel),
      paymentBlockingHint: takeoverPaymentBlockingHint(takeover, evidenceChecklist),
      evidenceGapSummary: evidenceGapSummary(evidenceChecklist),
      takeoverStatus: takeover.takeoverStatus,
      lifecycleStatus: takeover.lifecycleStatus,
      signedAt: takeover.signedAt,
      historicalSettledCents: moneyString(takeover.historicalSettledCents),
      historicalApprovalPendingPaymentCents: moneyString(
        takeover.historicalApprovalPendingPaymentCents
      ),
      historicalApprovedPendingPaymentCents: moneyString(
        takeover.historicalApprovedPendingPaymentCents
      ),
      historicalPaidCents: moneyString(takeover.historicalPaidCents),
      historicalProxyPaidCents: moneyString(takeover.historicalProxyPaidCents),
      historicalAdvancePaidCents: moneyString(takeover.historicalAdvancePaidCents),
      historicalAdvanceDeductedCents: moneyString(takeover.historicalAdvanceDeductedCents),
      historicalRetentionWithheldCents: moneyString(takeover.historicalRetentionWithheldCents),
      historicalRetentionReleasedCents: moneyString(takeover.historicalRetentionReleasedCents),
      otherConfirmedOccupancyCents: moneyString(takeover.otherConfirmedOccupancyCents),
      balanceSourceSummary: takeover.balanceSourceSummary,
      evidenceSummary: takeover.evidenceSummary,
      takeoverCutoffDate: takeover.takeoverCutoffDate,
      responsibleUserId: takeover.responsibleUserId,
      responsibleUserName: contract.responsibleUserName ?? null,
      reviewComment: takeover.reviewComment,
      acceptanceConclusion: takeover.acceptanceConclusion,
      submittedAt: takeover.submittedAt,
      confirmedAt: takeover.confirmedAt,
      historicalBalanceConfirmedAt: takeover.historicalBalanceConfirmedAt,
      evidenceChecklist,
      evidenceFiles: contract.evidenceFiles,
      corrections: contract.corrections,
      postConfirmationVerification: contract.postConfirmationVerification,
      createdAt: takeover.createdAt,
      updatedAt: takeover.updatedAt
    };
  }

  private toImportBatchReadModel(batch: {
    id: string;
    batchNo: string;
    status: string;
    takeoverCutoffDate: Date;
    responsibleUserId: string;
    responsibleUserName?: string | null;
    reviewComment: string;
    acceptanceConclusion: string;
    totalRows: number;
    readyRows: number;
    blockedRows: number;
    warningRows: number;
    createdCount: number;
    skippedCount: number;
  }): ContractTakeoverImportBatchReadModel {
    return {
      id: batch.id,
      batchNo: batch.batchNo,
      status: batch.status,
      statusLabel: importBatchStatusLabel(batch.status),
      riskText: importBatchRiskText(batch),
      takeoverCutoffDate: batch.takeoverCutoffDate,
      responsibleUserId: batch.responsibleUserId,
      responsibleUserName: batch.responsibleUserName ?? null,
      reviewComment: batch.reviewComment,
      acceptanceConclusion: batch.acceptanceConclusion,
      totalRows: batch.totalRows,
      readyRows: batch.readyRows,
      blockedRows: batch.blockedRows,
      warningRows: batch.warningRows,
      createdCount: batch.createdCount,
      skippedCount: batch.skippedCount
    };
  }

  private toCorrectionBeforeSnapshot(takeover: ContractTakeoverRecord): Prisma.InputJsonObject {
    return {
      takeoverLevel: takeover.takeoverLevel,
      takeoverStatus: takeover.takeoverStatus,
      lifecycleStatus: takeover.lifecycleStatus,
      signedAt: takeover.signedAt.toISOString(),
      historicalSettledCents: moneyString(takeover.historicalSettledCents),
      historicalApprovalPendingPaymentCents: moneyString(
        takeover.historicalApprovalPendingPaymentCents
      ),
      historicalApprovedPendingPaymentCents: moneyString(
        takeover.historicalApprovedPendingPaymentCents
      ),
      historicalPaidCents: moneyString(takeover.historicalPaidCents),
      historicalProxyPaidCents: moneyString(takeover.historicalProxyPaidCents),
      historicalAdvancePaidCents: moneyString(takeover.historicalAdvancePaidCents),
      historicalAdvanceDeductedCents: moneyString(takeover.historicalAdvanceDeductedCents),
      historicalRetentionWithheldCents: moneyString(takeover.historicalRetentionWithheldCents),
      historicalRetentionReleasedCents: moneyString(takeover.historicalRetentionReleasedCents),
      otherConfirmedOccupancyCents: moneyString(takeover.otherConfirmedOccupancyCents),
      balanceSourceSummary: takeover.balanceSourceSummary,
      evidenceSummary: takeover.evidenceSummary,
      takeoverCutoffDate: takeover.takeoverCutoffDate?.toISOString() ?? null,
      responsibleUserId: takeover.responsibleUserId,
      reviewComment: takeover.reviewComment,
      acceptanceConclusion: takeover.acceptanceConclusion,
      submittedAt: takeover.submittedAt?.toISOString() ?? null,
      confirmedAt: takeover.confirmedAt?.toISOString() ?? null,
      historicalBalanceConfirmedAt: takeover.historicalBalanceConfirmedAt?.toISOString() ?? null
    };
  }

  private normalizeImportBatchInput(input: PrecheckContractTakeoverImportDto) {
    const takeoverCutoffDate = input.takeoverCutoffDate?.trim();
    if (!takeoverCutoffDate) throw new Error("请填写接管截止日后再生成接管草稿");
    const responsibleUserId = input.responsibleUserId?.trim();
    if (!responsibleUserId) throw new Error("请填写接管责任人后再生成接管草稿");
    const reviewComment = input.reviewComment?.trim();
    if (!reviewComment) throw new Error("请填写批次复核意见后再生成接管草稿");
    const acceptanceConclusion = input.acceptanceConclusion?.trim();
    if (!acceptanceConclusion) throw new Error("请填写批次验收结论后再生成接管草稿");

    const cutoffDate = this.normalizeOptionalDate(takeoverCutoffDate, "takeoverCutoffDate");
    const batchNo = input.batchNo?.trim() || "";

    return {
      batchNo,
      takeoverCutoffDate: cutoffDate,
      responsibleUserId,
      reviewComment,
      acceptanceConclusion
    };
  }

  private defaultImportBatchNo(importFingerprint: string) {
    const dateText = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `接管批次-${dateText}-${importFingerprint.slice(0, 8).toUpperCase()}`;
  }

  private importFingerprint(
    rows: Record<string, unknown>[],
    batchInput?: ReturnType<ContractTakeoverService["normalizeImportBatchInput"]>
  ) {
    const batchFacts = batchInput
      ? {
          takeoverCutoffDate: batchInput.takeoverCutoffDate.toISOString(),
          responsibleUserId: batchInput.responsibleUserId,
          reviewComment: batchInput.reviewComment,
          acceptanceConclusion: batchInput.acceptanceConclusion
        }
      : null;
    return createHash("sha256")
      .update(JSON.stringify(stableObject({ batchFacts, rows })))
      .digest("hex");
  }

  private parsePrecheckRows(input: PrecheckContractTakeoverImportDto) {
    if (!isPlainObject(input) || !Array.isArray(input.rows)) {
      throw new Error("请粘贴需要预检的历史合同导入行");
    }
    if (input.rows.length === 0) {
      throw new Error("请至少保留一行导入数据");
    }
    if (input.rows.length > IMPORT_PRECHECK_MAX_ROWS) {
      throw new Error(`单次导入预检最多支持 ${IMPORT_PRECHECK_MAX_ROWS} 行，请分批处理`);
    }

    return input.rows.map((row, index) => {
      if (!isPlainObject(row)) {
        throw new Error(`第 ${index + 1} 行导入数据格式不正确，请重新粘贴`);
      }
      return row;
    });
  }

  private precheckImportRow(
    row: Record<string, unknown>,
    fallbackRowNo: number,
    existingCodes: ReadonlySet<string>,
    duplicatedCodes: ReadonlySet<string>
  ): ContractTakeoverImportPrecheckRow {
    const rowNo = integerOrFallback(row["rowNo"], fallbackRowNo);
    const issues: ContractTakeoverImportPrecheckIssue[] = [];
    const code = stringValue(row["code"]);
    const name = stringValue(row["name"]);
    const counterparty = stringValue(row["counterparty"]);
    const amountCents = integerValue(row["amountCents"]);
    const signedAt = stringValue(row["signedAt"]);
    const takeoverLevel = takeoverLevelInputValue(row["takeoverLevel"]);
    const lifecycleStatus = stringValue(row["lifecycleStatus"]);
    const evidenceChecklist = stringValue(row["evidenceChecklist"]);
    const issueSummary = stringValue(row["issueSummary"]);

    if (!code) {
      issues.push(issue(rowNo, "code", "error", "合同编号不能为空"));
    } else {
      if (existingCodes.has(code)) {
        issues.push(issue(rowNo, "code", "error", "合同编号已存在于系统"));
      }
      if (duplicatedCodes.has(code)) {
        issues.push(issue(rowNo, "code", "error", "合同编号在本次导入中重复"));
      }
    }
    if (!name) {
      issues.push(issue(rowNo, "name", "error", "合同名称不能为空"));
    }
    if (!counterparty) {
      issues.push(issue(rowNo, "counterparty", "error", "相对方不能为空"));
    }
    if (amountCents === null || amountCents <= 0) {
      issues.push(issue(rowNo, "amountCents", "error", "合同金额必须填写大于 0 的金额"));
    }
    if (!isStrictDateText(signedAt)) {
      issues.push(issue(rowNo, "signedAt", "error", dateInputMessage("签订日期")));
    }
    if (!TAKEOVER_LEVELS.includes(takeoverLevel as ContractTakeoverLevel)) {
      issues.push(issue(rowNo, "takeoverLevel", "error", "接管等级请选择 A级、B级或C级"));
    }
    if (!LIFECYCLE_STATUSES.includes(lifecycleStatus as ContractLifecycleStatus)) {
      issues.push(issue(rowNo, "lifecycleStatus", "error", "履约状态不在系统支持范围内"));
    }

    for (const field of MONEY_FIELDS) {
      const value = isBlankInput(row[field]) ? 0 : integerValue(row[field]);
      if (value === null || value < 0) {
        issues.push(issue(rowNo, field, "error", `${MONEY_FIELD_LABELS[field]}必须填写 0 或更大的金额`));
      }
    }

    if (!stringValue(row["paymentTermsOriginalText"])) {
      issues.push(issue(rowNo, "paymentTermsOriginalText", "warning", "未填写付款条款摘要"));
    }
    if (!stringValue(row["balanceSourceSummary"])) {
      issues.push(issue(rowNo, "balanceSourceSummary", "warning", "未填写余额来源说明"));
    }
    if (!stringValue(row["evidenceSummary"])) {
      issues.push(issue(rowNo, "evidenceSummary", "warning", "未填写证据说明"));
    }
    if (!evidenceChecklist) {
      issues.push(
        issue(
          rowNo,
          "evidenceChecklist",
          "warning",
          "未填写资料清单，无法判断合同扫描件、结算依据和付款凭证是否齐全"
        )
      );
    }
    if (
      TAKEOVER_LEVELS.includes(takeoverLevel as ContractTakeoverLevel) &&
      LIFECYCLE_STATUSES.includes(lifecycleStatus as ContractLifecycleStatus)
    ) {
      const suggestedLevel = suggestedTakeoverLevel({
        lifecycleStatus,
        balanceSourceSummary: stringValue(row["balanceSourceSummary"]),
        evidenceSummary: stringValue(row["evidenceSummary"]),
        historicalApprovalPendingPaymentCents: precheckMoneyValue(row, "historicalApprovalPendingPaymentCents"),
        historicalApprovedPendingPaymentCents: precheckMoneyValue(row, "historicalApprovedPendingPaymentCents"),
        historicalProxyPaidCents: precheckMoneyValue(row, "historicalProxyPaidCents"),
        historicalRetentionWithheldCents: precheckMoneyValue(row, "historicalRetentionWithheldCents"),
        otherConfirmedOccupancyCents: precheckMoneyValue(row, "otherConfirmedOccupancyCents")
      });
      if (takeoverLevel !== suggestedLevel && !issueSummary) {
        issues.push(
          issue(
            rowNo,
            "takeoverLevel",
            "warning",
            "接管等级与系统建议不一致，请在问题清单或批次复核意见说明调整原因"
          )
        );
      }
    }
    if (takeoverLevel === "A" && issueSummary) {
      issues.push(
        issue(
          rowNo,
          "issueSummary",
          "warning",
          "A级合同存在问题清单，请确认是否应降级或先补齐资料"
        )
      );
    }
    if (takeoverLevel === "C" && !issueSummary) {
      issues.push(
        issue(
          rowNo,
          "issueSummary",
          "warning",
          "C级合同应填写问题清单，说明缺口、责任人和是否影响付款"
        )
      );
    }

    return {
      rowNo,
      code,
      name,
      counterparty,
      amountCents,
      takeoverLevel,
      lifecycleStatus,
      evidenceChecklist,
      issueSummary,
      status: issues.some((item) => item.level === "error") ? "blocked" : "ready",
      issues
    };
  }

  private normalizeCreateInput(input: CreateContractTakeoverDto) {
    const takeoverLevel = takeoverLevelInputValue(input.takeoverLevel);
    if (!input.code?.trim()) throw new Error("请填写合同编号");
    if (!input.name?.trim()) throw new Error("请填写合同名称");
    if (!input.counterparty?.trim()) throw new Error("请填写相对方");
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("合同金额必须大于 0");
    }
    if (!TAKEOVER_LEVELS.includes(takeoverLevel as ContractTakeoverLevel)) {
      throw new Error("接管等级不正确，请重新选择");
    }
    if (!LIFECYCLE_STATUSES.includes(input.lifecycleStatus as ContractLifecycleStatus)) {
      throw new Error("履约状态不正确，请重新选择");
    }

    if (typeof input.signedAt !== "string" || !input.signedAt.trim()) {
      throw new Error(dateInputMessage("签订日期"));
    }

    if (!isStrictDateText(input.signedAt)) {
      throw new Error(dateInputMessage("签订日期"));
    }
    const signedAt = new Date(input.signedAt);
    const takeoverCutoffDate = input.takeoverCutoffDate?.trim()
      ? this.normalizeOptionalDate(input.takeoverCutoffDate, "takeoverCutoffDate")
      : null;

    const money = Object.fromEntries(
      MONEY_FIELDS.map((field) => {
        const value = input[field] ?? 0;
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`${MONEY_FIELD_LABELS[field]}必须填写 0 或更大的金额`);
        }
        return [field, value];
      })
    ) as Record<(typeof MONEY_FIELDS)[number], number>;
    const reviewComment = input.reviewComment?.trim() || null;
    const suggestedLevel = suggestedTakeoverLevel({
      lifecycleStatus: input.lifecycleStatus,
      balanceSourceSummary: input.balanceSourceSummary,
      evidenceSummary: input.evidenceSummary,
      historicalApprovalPendingPaymentCents: money.historicalApprovalPendingPaymentCents,
      historicalApprovedPendingPaymentCents: money.historicalApprovedPendingPaymentCents,
      historicalProxyPaidCents: money.historicalProxyPaidCents,
      historicalRetentionWithheldCents: money.historicalRetentionWithheldCents,
      otherConfirmedOccupancyCents: money.otherConfirmedOccupancyCents
    });
    if (takeoverLevel !== suggestedLevel && !reviewComment) {
      throw new Error("接管等级与系统建议不一致，请在复核意见说明调整原因");
    }

    return {
      ...input,
      ...money,
      code: input.code.trim(),
      name: input.name.trim(),
      counterparty: input.counterparty.trim(),
      takeoverLevel: takeoverLevel as ContractTakeoverLevel,
      suggestedTakeoverLevel: suggestedLevel,
      signedAt,
      takeoverCutoffDate,
      responsibleUserId: input.responsibleUserId?.trim() || null,
      reviewComment,
      acceptanceConclusion: input.acceptanceConclusion?.trim() || null
    };
  }

  private importRowToCreateInput(row: Record<string, unknown>): CreateContractTakeoverDto {
    return {
      code: stringValue(row["code"]),
      name: stringValue(row["name"]),
      counterparty: stringValue(row["counterparty"]),
      contractTypeKey: stringValue(row["contractTypeKey"]) || undefined,
      companyEntityName: stringValue(row["companyEntityName"]) || undefined,
      amountCents: integerValue(row["amountCents"]) ?? 0,
      signedAt: stringValue(row["signedAt"]),
      takeoverLevel: takeoverLevelInputValue(row["takeoverLevel"]) as ContractTakeoverLevel,
      lifecycleStatus: stringValue(row["lifecycleStatus"]) as ContractLifecycleStatus,
      paymentTermsOriginalText: stringValue(row["paymentTermsOriginalText"]),
      historicalSettledCents: integerValue(row["historicalSettledCents"]) ?? 0,
      historicalApprovalPendingPaymentCents:
        integerValue(row["historicalApprovalPendingPaymentCents"]) ?? 0,
      historicalApprovedPendingPaymentCents:
        integerValue(row["historicalApprovedPendingPaymentCents"]) ?? 0,
      historicalPaidCents: integerValue(row["historicalPaidCents"]) ?? 0,
      historicalProxyPaidCents: integerValue(row["historicalProxyPaidCents"]) ?? 0,
      historicalAdvancePaidCents: integerValue(row["historicalAdvancePaidCents"]) ?? 0,
      historicalAdvanceDeductedCents: integerValue(row["historicalAdvanceDeductedCents"]) ?? 0,
      historicalRetentionWithheldCents: integerValue(row["historicalRetentionWithheldCents"]) ?? 0,
      historicalRetentionReleasedCents: integerValue(row["historicalRetentionReleasedCents"]) ?? 0,
      otherConfirmedOccupancyCents: integerValue(row["otherConfirmedOccupancyCents"]) ?? 0,
      balanceSourceSummary: stringValue(row["balanceSourceSummary"]) || undefined,
      evidenceSummary: stringValue(row["evidenceSummary"]) || undefined
    };
  }

  private normalizeOptionalDate(value: string, field: string) {
    if (!isStrictDateText(value)) {
      throw new Error(dateInputMessage(dateFieldLabel(field)));
    }
    return new Date(value);
  }

  private takeoverInitialSettlementStage(
    paymentTermsVersionId: string,
    originalText?: string
  ): Prisma.PaymentTermsStageCreateManyInput {
    return {
      paymentTermsVersionId,
      name: "接管期初结算款",
      stageType: "progress",
      basis: "current_settlement",
      ratioBps: 10000,
      triggerAnchor: "settlement_effective",
      triggerEvent: "接管确认后形成期初有效结算",
      dueDays: 0,
      requiresInvoice: false,
      allowsEarlyPayment: false,
      allowsInstallments: true,
      originalText: originalText?.trim() || "接管确认的历史已结算未付款金额作为期初结算款。"
    };
  }

  private async createHistoricalInitialSettlement(
    tx: Prisma.TransactionClient,
    takeover: ContractTakeoverRecord
  ) {
    const amountCents = safeNumberCents(takeover.historicalSettledCents);
    if (amountCents <= 0) {
      return;
    }

    const contract = await tx.contract.findUnique({
      where: { id: takeover.contractId },
      select: { code: true, temporaryCode: true }
    });
    const contractNo = contract?.code ?? contract?.temporaryCode ?? takeover.contractId;

    await tx.settlement.create({
      data: {
        projectId: takeover.projectId,
        contractId: takeover.contractId,
        contractVersionId: takeover.contractVersionId,
        paymentTermsVersionId: takeover.paymentTermsVersionId,
        code: `${contractNo}-期初结算`,
        periodLabel: "历史期初",
        status: "effective",
        amountCents,
        payableAmountCents: amountCents,
        paidAmountCents: safeNumberCents(takeover.historicalPaidCents),
        sourceType: "historical_takeover",
        sourceTakeoverId: takeover.id
      }
    });
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function emptyPostConfirmationVerificationStats(): PostConfirmationVerificationStats {
  return {
    newSettlementCount: 0,
    paymentRequestCount: 0,
    paymentExecutionCount: 0,
    financeRecordCount: 0
  };
}

function isInactiveBusinessStatus(status: string): boolean {
  return ["approval_rejected", "rejected", "withdrawn", "voided"].includes(status);
}

function postConfirmationVerificationStatsByVersion(
  settlements: PostConfirmationSettlementRecord[],
  paymentRequests: PostConfirmationPaymentRequestRecord[],
  paymentExecutions: PostConfirmationPaymentExecutionRecord[],
  financeRecords: PostConfirmationFinanceRecord[]
): Map<string, PostConfirmationVerificationStats> {
  const statsByVersionId = new Map<string, PostConfirmationVerificationStats>();
  const paymentRequestVersionById = new Map(
    paymentRequests.map((request) => [request.id, request.contractVersionId])
  );

  const statsForVersion = (contractVersionId: string) => {
    const current = statsByVersionId.get(contractVersionId);
    if (current) return current;
    const stats = emptyPostConfirmationVerificationStats();
    statsByVersionId.set(contractVersionId, stats);
    return stats;
  };

  for (const settlement of settlements) {
    if (
      settlement.sourceType === "historical_takeover" ||
      settlement.sourceTakeoverId ||
      isInactiveBusinessStatus(settlement.status)
    ) {
      continue;
    }
    statsForVersion(settlement.contractVersionId).newSettlementCount += 1;
  }
  for (const request of paymentRequests) {
    statsForVersion(request.contractVersionId).paymentRequestCount += 1;
  }
  for (const execution of paymentExecutions) {
    const contractVersionId = paymentRequestVersionById.get(execution.paymentRequestId);
    if (contractVersionId) statsForVersion(contractVersionId).paymentExecutionCount += 1;
  }
  for (const record of financeRecords) {
    const contractVersionId = record.paymentRequestId
      ? paymentRequestVersionById.get(record.paymentRequestId)
      : null;
    if (contractVersionId) statsForVersion(contractVersionId).financeRecordCount += 1;
  }

  return statsByVersionId;
}

function postConfirmationVerificationReadModel(
  takeover: Pick<ContractTakeoverRecord, "takeoverStatus">,
  stats: PostConfirmationVerificationStats
): ContractTakeoverPostConfirmationVerificationReadModel {
  if (takeover.takeoverStatus !== "confirmed") {
    return {
      statusLabel: "未到核验",
      summaryText:
        "主管确认后，再用接管后的新结算、付款申请、实付凭证和财务入账核验期初账本。",
      ...stats
    };
  }

  const hasAnyFact = [
    stats.newSettlementCount,
    stats.paymentRequestCount,
    stats.paymentExecutionCount,
    stats.financeRecordCount
  ].some((count) => count > 0);
  const hasFullLoop = [
    stats.newSettlementCount,
    stats.paymentRequestCount,
    stats.paymentExecutionCount,
    stats.financeRecordCount
  ].every((count) => count > 0);

  if (hasFullLoop) {
    return {
      statusLabel: "已形成闭环",
      summaryText:
        "已看到接管后的新结算、付款申请、实付凭证和财务入账，可作为试运行核验证据继续抽查审计记录。",
      ...stats
    };
  }

  if (hasAnyFact) {
    return {
      statusLabel: "核验中",
      summaryText:
        "已看到部分接管后的业务事实，请继续补齐新结算、付款申请、实付凭证和财务入账，完成闭环核验。",
      ...stats
    };
  }

  return {
    statusLabel: "待核验",
    summaryText: "主管已确认接管，但尚未看到接管后的新结算、付款申请、实付凭证或财务入账。",
    ...stats
  };
}

function dateFieldLabel(field: string): string {
  if (field === "takeoverCutoffDate") return "接管截止日";
  return "日期";
}

function dateInputMessage(label: string): string {
  return `${label}不正确，请按“年-月-日”填写，例如 2026-01-10`;
}

function moneyString(value: bigint | number): string {
  return (typeof value === "bigint" ? value : BigInt(value)).toString();
}

function correctionTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    amount: "金额更正",
    payment_terms: "付款条款更正",
    evidence: "资料更正",
    other: "其他更正"
  };
  return labels[value] ?? "更正事项未读取";
}

function takeoverLevelDisplay(value: string): string {
  if (TAKEOVER_LEVELS.includes(value as ContractTakeoverLevel)) return `${value}级`;
  return "等级未读取";
}

function correctionBeforeSummary(snapshot: unknown): string {
  if (!isPlainObject(snapshot)) return "改前记录未读取";
  const parts = [
    `接管等级 ${takeoverLevelDisplay(String(snapshot.takeoverLevel ?? ""))}`,
    `历史累计结算 ${formatCents(snapshot.historicalSettledCents)}`,
    `历史累计已付 ${formatCents(snapshot.historicalPaidCents)}`
  ];
  const evidenceSummary = stringValue(snapshot.evidenceSummary);
  if (evidenceSummary) {
    parts.push(`证据说明：${evidenceSummary}`);
  }
  return `改前：${parts.join("；")}`;
}

function correctionAfterSummary(snapshot: unknown): string {
  if (!isPlainObject(snapshot)) return "更正后的事实说明未读取";
  return stringValue(snapshot.summary) || "更正后的事实说明未读取";
}

function formatCents(value: unknown): string {
  const cents = integerValue(value);
  if (cents === null) return "金额未读取";
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, "0");
  const sign = cents < 0 ? "-" : "";
  return `${sign}¥${formatInteger(yuan)}.${centsPart}`;
}

function formatInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function safeNumberCents(value: bigint | number): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error("历史接管金额超过系统支持范围，请拆分或核对后再确认");
  }
  return numberValue;
}

function evidencePurpose(value: string): ContractTakeoverEvidencePurpose {
  return EVIDENCE_PURPOSES.includes(value as ContractTakeoverEvidencePurpose)
    ? (value as ContractTakeoverEvidencePurpose)
    : "other";
}

function evidencePurposeLabel(value: ContractTakeoverEvidencePurpose) {
  const labels: Record<ContractTakeoverEvidencePurpose, string> = {
    historical_contract_scan: "历史合同扫描件",
    historical_settlement_ledger: "历史结算台账",
    historical_payment_voucher: "历史付款凭证",
    other: "其他接管资料"
  };

  return labels[value];
}

function takeoverEvidenceChecklist(
  takeover: Pick<
    ContractTakeoverRecord,
    | "historicalSettledCents"
    | "historicalApprovalPendingPaymentCents"
    | "historicalApprovedPendingPaymentCents"
    | "historicalPaidCents"
    | "historicalProxyPaidCents"
    | "historicalAdvancePaidCents"
    | "historicalRetentionWithheldCents"
    | "otherConfirmedOccupancyCents"
  >,
  evidenceFiles: ContractTakeoverEvidenceFileReadModel[]
): ContractTakeoverEvidenceChecklistItemReadModel[] {
  const uploadedPurposes = new Set(evidenceFiles.map((file) => file.purpose));
  const requiredPurposes: ContractTakeoverEvidencePurpose[] = ["historical_contract_scan"];
  if (positiveCents(takeover.historicalSettledCents)) {
    requiredPurposes.push("historical_settlement_ledger");
  }
  if (
    [
      takeover.historicalApprovalPendingPaymentCents,
      takeover.historicalApprovedPendingPaymentCents,
      takeover.historicalPaidCents,
      takeover.historicalProxyPaidCents,
      takeover.historicalAdvancePaidCents,
      takeover.historicalRetentionWithheldCents,
      takeover.otherConfirmedOccupancyCents
    ].some(positiveCents)
  ) {
    requiredPurposes.push("historical_payment_voucher");
  }

  return unique(requiredPurposes).map((purpose) => {
    const uploaded = uploadedPurposes.has(purpose);
    return {
      purpose,
      purposeLabel: evidencePurposeLabel(purpose),
      required: true,
      uploaded,
      statusLabel: uploaded ? "已上传" : "待补齐",
      riskText: uploaded ? "已上传，可作为接管复核依据。" : missingEvidenceRiskText(purpose)
    };
  });
}

function positiveCents(value: bigint | number): boolean {
  return typeof value === "bigint" ? value > 0n : value > 0;
}

function missingEvidenceRiskText(purpose: ContractTakeoverEvidencePurpose): string {
  const texts: Record<ContractTakeoverEvidencePurpose, string> = {
    historical_contract_scan: "缺少历史合同扫描件，接管事实无法完整核验。",
    historical_settlement_ledger: "缺少历史结算台账，期初结算来源需要补证。",
    historical_payment_voucher: "缺少历史付款凭证，后续付款容量核对会受影响。",
    other: "缺少其他接管资料，请补充说明后再复核。"
  };

  return texts[purpose];
}

function evidenceGapSummary(
  checklist: ContractTakeoverEvidenceChecklistItemReadModel[]
): string {
  const missingLabels = checklist
    .filter((item) => item.required && !item.uploaded)
    .map((item) => item.purposeLabel);
  if (!missingLabels.length) {
    return "关键接管资料已上传，复核时仍需核对金额口径。";
  }

  return `缺少：${missingLabels.join("、")}。补齐前会影响主管确认和后续付款核验。`;
}

function importBatchStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    drafts_generated: "已生成草稿",
    under_review: "复核中",
    accepted: "已验收",
    limited_accepted: "受限验收",
    disputed: "存在争议"
  };

  return labels[status] ?? "待核对";
}

function importBatchRiskText(batch: {
  status: string;
  blockedRows: number;
  warningRows: number;
  skippedCount: number;
}): string {
  if (batch.status === "accepted") return "批次已验收，可按单合同确认结果继续办理。";
  if (batch.status === "limited_accepted") return "批次为受限验收，缺口未补齐前系统仍会限制或阻断付款。";
  if (batch.status === "disputed") return "批次存在争议，争议解决前不能作为付款放行依据。";
  if (batch.status === "under_review") return "批次正在复核，请合同、预算和财务核对资料与金额口径。";
  if (batch.blockedRows > 0) return "仍有错误行，先修正后再接管。";
  if (batch.warningRows > 0) return "存在资料或风险提醒，复核时重点核对。";
  if (batch.skippedCount > 0) return "有重复导入记录，已跳过未重复建账。";
  return "预检通过，等待资料核验和复核确认。";
}

function canMoveImportBatchStatus(fromStatus: string, toStatus: ContractTakeoverImportBatchReviewStatus) {
  if (fromStatus === "drafts_generated") return toStatus === "under_review";
  if (fromStatus === "under_review") return IMPORT_BATCH_FINAL_STATUSES.includes(toStatus);
  return false;
}

function takeoverLevelRiskText(level: string): string {
  const texts: Record<string, string> = {
    A: "A级资料较完整，可作为首批活跃合同接管，仍需保留原始资料备查。",
    B: "B级存在少量资料或说明缺口，接管后需继续跟踪，影响金额的资料补齐前不宜付款。",
    C: "C级资料缺口明显或存在争议，只能作为受限期初事实，付款前必须重点核验。"
  };

  return texts[level] ?? "请按接管等级复核资料完整性和后续付款风险。";
}

function takeoverPaymentBlockingHint(
  takeover: Pick<ContractTakeoverRecord, "takeoverLevel" | "takeoverStatus">,
  evidenceChecklist: ContractTakeoverEvidenceChecklistItemReadModel[]
): string {
  if (takeover.takeoverStatus !== "confirmed") {
    return "尚未完成主管确认，后续付款申请会被系统阻断。";
  }
  if (takeover.takeoverLevel === "C") {
    return "C级资料缺口明显，付款前必须补齐影响金额的资料和争议说明。";
  }
  const missingLabels = evidenceChecklist
    .filter((item) => item.required && !item.uploaded)
    .map((item) => item.purposeLabel);
  if (missingLabels.length) {
    return `仍缺少${missingLabels.join("、")}，付款前必须补齐或形成受限确认说明。`;
  }
  if (takeover.takeoverLevel === "B") {
    return "B级资料仍需跟踪，付款前需确认影响金额的缺口已补齐。";
  }
  return "接管资料等级满足继续办理要求，后续付款仍按有效结算和付款条款校验。";
}

function suggestedTakeoverLevel(input: {
  lifecycleStatus: string;
  balanceSourceSummary?: string | null;
  evidenceSummary?: string | null;
  historicalApprovalPendingPaymentCents: number;
  historicalApprovedPendingPaymentCents: number;
  historicalProxyPaidCents: number;
  historicalRetentionWithheldCents: number;
  otherConfirmedOccupancyCents: number;
}): ContractTakeoverLevel {
  const evidenceText = `${input.balanceSourceSummary ?? ""} ${input.evidenceSummary ?? ""}`;
  if (input.lifecycleStatus === "disputed" || /争议|缺|待补|受限|无法|不一致/.test(evidenceText)) {
    return "C";
  }

  if (
    input.historicalApprovalPendingPaymentCents > 0 ||
    input.historicalApprovedPendingPaymentCents > 0 ||
    input.historicalProxyPaidCents > 0 ||
    input.historicalRetentionWithheldCents > 0 ||
    input.otherConfirmedOccupancyCents > 0
  ) {
    return "B";
  }

  if (!input.balanceSourceSummary?.trim() || !input.evidenceSummary?.trim()) {
    return "B";
  }

  return "A";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function takeoverLevelInputValue(value: unknown): string {
  const text = stringValue(value).toUpperCase();
  const matched = text.match(/^([ABC])(?:级)?/u);
  return matched?.[1] ?? text;
}

function integerValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "bigint") {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function integerOrFallback(value: unknown, fallback: number): number {
  const parsed = integerValue(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function isBlankInput(value: unknown): boolean {
  return value === undefined || value === "";
}

function precheckMoneyValue(
  row: Record<string, unknown>,
  field: (typeof MONEY_FIELDS)[number]
): number {
  if (isBlankInput(row[field])) {
    return 0;
  }
  return integerValue(row[field]) ?? 0;
}

function isStrictDateText(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableObject(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableObject(value[key]);
      return result;
    }, {});
}

function issue(
  rowNo: number,
  field: string,
  level: ContractTakeoverImportPrecheckIssueLevel,
  message: string
): ContractTakeoverImportPrecheckIssue {
  return { rowNo, field, level, message };
}

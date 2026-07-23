import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { normalizeTaxRatePercent } from "@jiangkong/shared-domain";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  calculateBillRow,
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  parseMoneyCents,
  parseMoneyCentsInput
} from "../money/decimal-money";
import type {
  AttachContractTakeoverEvidenceDto,
  AttachHistoricalPaymentVoucherDto,
  ContractTakeoverEvidencePurpose
} from "./dto/attach-contract-takeover-evidence.dto";
import type { ConfirmContractTakeoverDto } from "./dto/confirm-contract-takeover.dto";
import type { ConfirmContractChangeBaselineDto } from "./dto/confirm-contract-change-baseline.dto";
import type {
  ContractLifecycleStatus,
  ContractTakeoverLevel,
  CreateContractTakeoverDto,
  HistoricalPricingItemDto,
  UpdateContractTakeoverDto
} from "./dto/create-contract-takeover.dto";
import type { PrecheckContractTakeoverImportDto } from "./dto/precheck-contract-takeover-import.dto";
import type {
  ContractTakeoverImportBatchReviewStatus,
  ReviewContractTakeoverImportBatchDto
} from "./dto/review-contract-takeover-import-batch.dto";
import type { AbandonContractTakeoverDto } from "./dto/abandon-contract-takeover.dto";
import type { AbandonContractTakeoverBatchDto } from "./dto/abandon-contract-takeover-batch.dto";
import type {
  ContractTakeoverCorrectionType,
  RecordContractTakeoverCorrectionDto
} from "./dto/record-contract-takeover-correction.dto";
import type {
  ReviewContractTakeoverCompanyEntityCorrectionDto,
  SubmitContractTakeoverCompanyEntityCorrectionDto
} from "./dto/contract-takeover-company-entity-correction.dto";
import type { ReturnContractTakeoverForSupplementDto } from "./dto/return-contract-takeover-for-supplement.dto";

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
const SETTLEMENT_CONTRACT_TYPE_KEYS = new Set([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
]);

type TakeoverClient = Pick<Prisma.TransactionClient, "contractTakeover">;

type HistoricalPricingItem = {
  billKey: string;
  billName: string;
  rowKey: string;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  quantity: string | null;
  unitPrice: string | null;
  taxRatePercent: string | null;
  taxRateSource: "version_default" | "row_override";
  isProvisional: boolean;
  settlementBasis: string | null;
  taxInclusiveAmountCents: bigint | null;
  taxExclusiveAmountCents: bigint | null;
  taxAmountCents: bigint | null;
};
type TakeoverReadClient = Pick<
  Prisma.TransactionClient,
  | "contract"
  | "contractVersion"
  | "paymentTermsVersion"
  | "paymentTermsStage"
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

type HistoricalContractVersionFacts = {
  id: string;
  amountCents: bigint;
  originalBaseAmountCents?: bigint | null;
  cumulativeIncreaseCents?: bigint;
  invoiceType?: string | null;
  taxMode?: string | null;
  defaultTaxRatePercent?: Prisma.Decimal | null;
  taxFactStatus?: string | null;
  taxFactSource?: string | null;
  taxFactExplanation?: string | null;
};

type HistoricalPaymentTermsStageRecord = {
  id: string;
  paymentTermsVersionId: string;
  name: string;
  stageType: string;
  basis: string;
  ratioBps: number | null;
  fixedAmountCents: bigint | null;
  triggerAnchor: string;
  dueDays: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
};

type HistoricalContractBillRecord = {
  id: string;
  contractVersionId: string;
  billKey: string;
  name: string;
};

type HistoricalContractBillRowRecord = {
  contractBillId: string;
  rowKey: string;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  taxRate: Prisma.Decimal | null;
  pricingFactStatus: string;
  isProvisional: boolean;
  settlementBasis: string | null;
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
  historicalSettledCents: bigint;
  historicalApprovalPendingPaymentCents: bigint;
  historicalApprovedPendingPaymentCents: bigint;
  historicalPaidCents: bigint;
  historicalProxyPaidCents: bigint;
  historicalAdvancePaidCents: bigint;
  historicalAdvanceDeductedCents: bigint;
  historicalRetentionWithheldCents: bigint;
  historicalRetentionReleasedCents: bigint;
  otherConfirmedOccupancyCents: bigint;
  balanceSourceSummary: string | null;
  evidenceSummary: string | null;
  takeoverCutoffDate: Date | null;
  responsibleUserId: string | null;
  reviewComment: string | null;
  acceptanceConclusion: string | null;
  createdByUserId: string;
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
  companyEntityId: string | null;
  companyEntityName: string | null;
  contractTypeKey: string | null;
  amountCents: string;
  paymentTermsOriginalText: string;
  paymentStages: HistoricalTakeoverDirectPaymentStageReadModel[];
  invoiceType: string | null;
  taxMode: string;
  defaultTaxRatePercent: string | null;
  taxFactStatus: string;
  taxFactSource: string | null;
  taxFactExplanation: string | null;
  taxFactMissingFields: string[];
  pricingItems: HistoricalPricingItemReadModel[];
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
  changeBaselineConfirmed: boolean;
  originalBaseAmountCents: string | null;
  preTakeoverPositiveIncreaseCents: string | null;
  evidenceChecklist: ContractTakeoverEvidenceChecklistItemReadModel[];
  evidenceFiles: ContractTakeoverEvidenceFileReadModel[];
  corrections: ContractTakeoverCorrectionReadModel[];
  postConfirmationVerification: ContractTakeoverPostConfirmationVerificationReadModel;
  lifecycleKind: "pristine_draft" | "approval_draft" | "formal_record";
  lifecycleBlockers: string[];
  availableActions: Array<{
    key: string; label: string; kind: "danger"; enabled: boolean;
    disabledReason: string | null; requiresComment?: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface HistoricalTakeoverDirectPaymentStageReadModel {
  id: string;
  name: string;
  ratioBps: number | null;
  fixedAmountCents: string | null;
  dueDays: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
}

export interface HistoricalPricingItemReadModel {
  billKey: string;
  billName: string;
  rowKey: string;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  estimatedQuantity: string | null;
  taxInclusiveUnitPrice: string | null;
  taxRatePercent: string | null;
  pricingFactStatus: string;
  isProvisional: boolean;
  settlementBasis: string | null;
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
  status: string;
  statusLabel: string;
  targetCompanyEntityId: string | null;
  reason: string;
  beforeSummary: string;
  afterSummary: string;
  responsibleUserName: string;
  createdByName: string;
  submittedByName: string;
  submittedAt: Date;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  attachmentFileId: string;
  attachmentFileName: string;
  createdAt: Date;
}

export interface ContractTakeoverCompanyEntityCandidateReadModel {
  id: string;
  name: string;
  unifiedSocialCreditCode: string | null;
  dataStatus: string;
  isActive: boolean;
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
  amountCents: string | null;
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

  async listCompanyEntityCandidates(): Promise<ContractTakeoverCompanyEntityCandidateReadModel[]> {
    return this.prisma.companyEntity.findMany({
      select: {
        id: true,
        name: true,
        unifiedSocialCreditCode: true,
        dataStatus: true,
        isActive: true
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }]
    });
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

    await this.assertCompanyEntityExists(tx, data.companyEntityId);

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
          amountCents: dbMoneyToBigInt(data.amountCents, "合同金额"),
          pricingNature: data.pricingNature,
          amountLimitType: data.amountLimitType,
          amountSource: data.amountSource,
          invoiceType: data.invoiceType,
          taxMode: data.taxMode,
          defaultTaxRatePercent: data.defaultTaxRatePercent,
          taxFactStatus: "unconfirmed",
          taxFactSource: data.taxFactSource,
          taxFactExplanation: data.taxFactExplanation,
          taxFactEvidenceFileId: data.taxFactEvidenceFileId,
          draftData: { historicalTakeover: true } as Prisma.InputJsonValue,
          templateSnapshot: { historicalTakeover: true } as Prisma.InputJsonValue,
          clauseSnapshot: [] as Prisma.InputJsonValue
        }
      });

      if (data.pricingItems.length) {
        await this.replaceHistoricalPricingItems(
          tx,
          version.id,
          data.pricingItems
        );
      }

      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: data.paymentTermsOriginalText ?? ""
        }
      });
      const paymentStages = this.takeoverPaymentStages(
        terms.id,
        data.contractTypeKey,
        data.paymentStages,
        data.paymentTermsOriginalText
      );
      await tx.paymentTermsStage.createMany({ data: paymentStages });

      const takeover = await tx.contractTakeover.create({
        data: {
          projectId,
          contractId: contract.id,
          contractVersionId: version.id,
          paymentTermsVersionId: terms.id,
          takeoverLevel: data.takeoverLevel,
          suggestedTakeoverLevel: data.suggestedTakeoverLevel,
          takeoverLevelAdjustmentReason: data.takeoverLevelAdjustmentReason,
          takeoverStatus: "draft",
          takeoverBatchId: options.takeoverBatchId,
          importRowNo: options.importRowNo,
          lifecycleStatus: data.lifecycleStatus,
          signedAt: data.signedAt,
          historicalSettledCents: dbMoneyToBigInt(data.historicalSettledCents, "历史累计结算"),
          historicalApprovalPendingPaymentCents: dbMoneyToBigInt(
            data.historicalApprovalPendingPaymentCents,
            "历史审批中付款"
          ),
          historicalApprovedPendingPaymentCents: dbMoneyToBigInt(
            data.historicalApprovedPendingPaymentCents,
            "历史已批待付款"
          ),
          historicalPaidCents: dbMoneyToBigInt(data.historicalPaidCents, "历史累计已付"),
          historicalProxyPaidCents: dbMoneyToBigInt(data.historicalProxyPaidCents, "历史代付"),
          historicalAdvancePaidCents: dbMoneyToBigInt(
            data.historicalAdvancePaidCents,
            "历史预付款已付"
          ),
          historicalAdvanceDeductedCents: dbMoneyToBigInt(
            data.historicalAdvanceDeductedCents,
            "历史预付款已扣回"
          ),
          historicalRetentionWithheldCents: dbMoneyToBigInt(
            data.historicalRetentionWithheldCents,
            "历史质保金扣留"
          ),
          historicalRetentionReleasedCents: dbMoneyToBigInt(
            data.historicalRetentionReleasedCents,
            "历史质保金释放"
          ),
          otherConfirmedOccupancyCents: dbMoneyToBigInt(
            data.otherConfirmedOccupancyCents,
            "历史其他确认占用"
          ),
          balanceSourceSummary: data.balanceSourceSummary ?? null,
          evidenceSummary: data.evidenceSummary ?? null,
          takeoverCutoffDate: data.takeoverCutoffDate,
          responsibleUserId: data.responsibleUserId ?? actorUserId,
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
          takeoverLevelAdjustmentReason: data.takeoverLevelAdjustmentReason,
          takeoverBatchId: options.takeoverBatchId ?? null,
          importRowNo: options.importRowNo ?? null
        }
      });

      return this.toReadModel(takeover, {
        contractNo: data.code,
        contractName: data.name,
        counterparty: data.counterparty,
        companyEntityId: data.companyEntityId ?? null,
        companyEntityName: data.companyEntityName ?? null,
        contractTypeKey: data.contractTypeKey ?? null,
        amountCents: data.amountCents,
        paymentTermsOriginalText: data.paymentTermsOriginalText ?? "",
        paymentStages: this.takeoverDirectStageReadModels(paymentStages),
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

      await this.assertCompanyEntityExists(tx, data.companyEntityId);

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
        data: {
          amountCents: dbMoneyToBigInt(data.amountCents, "合同金额"),
          pricingNature: data.pricingNature,
          amountLimitType: data.amountLimitType,
          amountSource: data.amountSource,
          ...(data.taxFactsProvided
            ? {
                invoiceType: data.invoiceType,
                taxMode: data.taxMode,
                defaultTaxRatePercent: data.defaultTaxRatePercent,
                taxFactStatus: "unconfirmed",
                taxFactSource: data.taxFactSource,
                taxFactExplanation: data.taxFactExplanation,
                taxFactEvidenceFileId: data.taxFactEvidenceFileId
              }
            : {})
        }
      });
      if (data.pricingItemsProvided) {
        await this.replaceHistoricalPricingItems(
          tx,
          takeover.contractVersionId,
          data.pricingItems
        );
      }
      await tx.paymentTermsVersion.update({
        where: { id: takeover.paymentTermsVersionId },
        data: { originalText: data.paymentTermsOriginalText ?? "" }
      });
      await tx.paymentTermsStage.deleteMany({
        where: { paymentTermsVersionId: takeover.paymentTermsVersionId }
      });
      const paymentStages = this.takeoverPaymentStages(
        takeover.paymentTermsVersionId,
        data.contractTypeKey,
        data.paymentStages,
        data.paymentTermsOriginalText
      );
      await tx.paymentTermsStage.createMany({ data: paymentStages });
      const updated = await tx.contractTakeover.update({
        where: { id: takeover.id },
        data: {
          takeoverLevel: data.takeoverLevel,
          lifecycleStatus: data.lifecycleStatus,
          signedAt: data.signedAt,
          historicalSettledCents: dbMoneyToBigInt(data.historicalSettledCents, "历史累计结算"),
          historicalApprovalPendingPaymentCents: dbMoneyToBigInt(
            data.historicalApprovalPendingPaymentCents,
            "历史审批中付款"
          ),
          historicalApprovedPendingPaymentCents: dbMoneyToBigInt(
            data.historicalApprovedPendingPaymentCents,
            "历史已批待付款"
          ),
          historicalPaidCents: dbMoneyToBigInt(data.historicalPaidCents, "历史累计已付"),
          historicalProxyPaidCents: dbMoneyToBigInt(data.historicalProxyPaidCents, "历史代付"),
          historicalAdvancePaidCents: dbMoneyToBigInt(
            data.historicalAdvancePaidCents,
            "历史预付款已付"
          ),
          historicalAdvanceDeductedCents: dbMoneyToBigInt(
            data.historicalAdvanceDeductedCents,
            "历史预付款已扣回"
          ),
          historicalRetentionWithheldCents: dbMoneyToBigInt(
            data.historicalRetentionWithheldCents,
            "历史质保金扣留"
          ),
          historicalRetentionReleasedCents: dbMoneyToBigInt(
            data.historicalRetentionReleasedCents,
            "历史质保金释放"
          ),
          otherConfirmedOccupancyCents: dbMoneyToBigInt(
            data.otherConfirmedOccupancyCents,
            "历史其他确认占用"
          ),
          balanceSourceSummary: data.balanceSourceSummary ?? null,
          evidenceSummary: data.evidenceSummary ?? null,
          suggestedTakeoverLevel: data.suggestedTakeoverLevel,
          takeoverLevelAdjustmentReason: data.takeoverLevelAdjustmentReason,
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
          takeoverLevelAdjustmentReason: data.takeoverLevelAdjustmentReason
        }
      });

      return this.toReadModel(updated, {
        contractNo: data.code,
        contractName: data.name,
        counterparty: data.counterparty,
        companyEntityId: data.companyEntityId ?? null,
        companyEntityName: data.companyEntityName ?? null,
        contractTypeKey: data.contractTypeKey ?? null,
        amountCents: data.amountCents,
        paymentTermsOriginalText: data.paymentTermsOriginalText ?? "",
        paymentStages: this.takeoverDirectStageReadModels(paymentStages),
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
    if (input.purpose === "historical_payment_voucher") {
      throw new Error("历史付款凭证只能由财务部成员或财务部主管在专用入口补充");
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

  async attachHistoricalPaymentVoucher(
    projectId: string,
    takeoverId: string,
    input: AttachHistoricalPaymentVoucherDto,
    actorUserId: string
  ) {
    const fileId = input.fileId?.trim();
    if (!fileId) {
      throw new Error("请先选择要挂接的历史付款凭证文件");
    }

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (takeover.takeoverStatus !== "needs_supplement") {
        throw new Error("历史付款凭证只能在主管退回补充后由财务补充");
      }
      if (!requiresHistoricalPaymentVoucher(takeover)) {
        throw new Error("当前接管记录不需要补充历史付款凭证");
      }
      if (!this.files) {
        throw new Error("系统暂不能读取历史付款凭证文件，请稍后重试");
      }
      try {
        await this.files.assertCanDownloadFile(tx, fileId, actorUserId);
      } catch {
        throw new Error("当前账号无权读取该历史付款凭证文件");
      }

      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "contract_takeover",
          businessId: takeover.id,
          fileId,
          departmentScope: "historical_payment_voucher"
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.payment_evidence.attach",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          fileId,
          archiveRecordId: archiveRecord.id,
          purpose: "historical_payment_voucher"
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

  async submitCompanyEntityCorrection(
    projectId: string,
    takeoverId: string,
    input: SubmitContractTakeoverCompanyEntityCorrectionDto,
    actorUserId: string
  ) {
    const targetCompanyEntityId = input.targetCompanyEntityId?.trim();
    if (!targetCompanyEntityId) throw new Error("请选择更正后的我方签约主体");
    const reason = input.reason?.trim();
    if (!reason) throw new Error("请填写更正原因");
    const responsibleUserId = input.responsibleUserId?.trim();
    if (!responsibleUserId) throw new Error("请选择更正责任人");
    const attachmentFileId = input.attachmentFileId?.trim();
    if (!attachmentFileId) throw new Error("请上传更正依据附件");
    const currentPassword = input.currentPassword?.trim();
    if (!currentPassword) throw new Error("请填写当前登录密码后再提交主体更正");
    if (!this.auth) throw new Error("系统暂不能确认当前密码，请稍后重试");
    await this.auth.confirmPassword(actorUserId, currentPassword);

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (takeover.takeoverStatus !== "confirmed") {
        throw new Error("接管尚未主管确认，请直接在草稿或待补充阶段修改主体匹配");
      }
      await this.assertProjectContractStaff(tx, projectId, actorUserId);
      if (!this.files) throw new Error("系统暂不能读取更正依据附件，请稍后重试");
      await this.files.assertCanAttachUnlinkedFile(tx, attachmentFileId, actorUserId);
      const [contract, targetCompanyEntity, responsibleUser, pendingCorrection] =
        await Promise.all([
          tx.contract.findUnique({
            where: { id: takeover.contractId },
            select: { id: true, companyEntityId: true, companyEntityName: true }
          }),
          tx.companyEntity.findUnique({
            where: { id: targetCompanyEntityId },
            select: { id: true, name: true, dataStatus: true, isActive: true }
          }),
          tx.user.findUnique({
            where: { id: responsibleUserId },
            select: { id: true, isActive: true }
          }),
          tx.contractTakeoverCorrection.findFirst({
            where: {
              takeoverId: takeover.id,
              correctionType: "company_entity",
              status: "submitted"
            },
            select: { id: true }
          })
        ]);
      if (!contract) throw new Error("未找到接管合同，请刷新后重试");
      if (!targetCompanyEntity) throw new Error("更正后的我方签约主体不存在，请重新选择");
      if (!responsibleUser?.isActive) throw new Error("更正责任人不存在或已停用，请重新选择");
      if (contract.companyEntityId === targetCompanyEntity.id) {
        throw new Error("更正后的主体与当前匹配主体相同，无需提交更正");
      }
      if (pendingCorrection) {
        throw new Error("该接管合同已有待主管处理的主体更正，请勿重复提交");
      }

      const now = new Date();
      let correction;
      try {
        correction = await tx.contractTakeoverCorrection.create({
          data: {
            projectId,
            takeoverId: takeover.id,
            correctionType: "company_entity",
            status: "submitted",
            targetCompanyEntityId: targetCompanyEntity.id,
            beforeSnapshot: {
              companyEntityId: contract.companyEntityId,
              companyEntityName: contract.companyEntityName
            },
            afterSnapshot: {
              companyEntityId: targetCompanyEntity.id,
              companyEntityName: targetCompanyEntity.name,
              dataStatus: targetCompanyEntity.dataStatus,
              isActive: targetCompanyEntity.isActive
            },
            reason,
            responsibleUserId,
            attachmentFileId,
            createdByUserId: actorUserId,
            submittedByUserId: actorUserId,
            submittedAt: now
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new BadRequestException("该接管合同已有待主管处理的主体更正，请勿重复提交");
        }
        if (isCompanyEntityCorrectionAttachmentConflict(error)) {
          throw new BadRequestException(
            "该文件已用于其他业务，请重新上传专用的更正依据附件"
          );
        }
        throw error;
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.company_entity_correction.submit",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          correctionId: correction.id,
          beforeCompanyEntityId: contract.companyEntityId,
          targetCompanyEntityId: targetCompanyEntity.id,
          responsibleUserId,
          attachmentFileId
        }
      });
      return { id: correction.id, status: "submitted", message: "主体更正已提交，等待合同部主管确认" };
    });
  }

  async reviewCompanyEntityCorrection(
    projectId: string,
    takeoverId: string,
    correctionId: string,
    input: ReviewContractTakeoverCompanyEntityCorrectionDto,
    actorUserId: string
  ) {
    const decision = input.decision;
    if (!(["approve", "reject"] as const).includes(decision)) {
      throw new Error("主体更正处理结果不正确");
    }
    const reviewComment = input.comment?.trim() || null;
    if (decision === "reject" && !reviewComment) throw new Error("驳回主体更正时请填写处理意见");
    const currentPassword = input.currentPassword?.trim();
    if (!currentPassword) throw new Error("请填写当前登录密码后再处理主体更正");
    if (!this.auth) throw new Error("系统暂不能确认当前密码，请稍后重试");
    await this.auth.confirmPassword(actorUserId, currentPassword);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (takeover.takeoverStatus !== "confirmed") {
        throw new Error("接管记录尚未确认，不能处理主体更正");
      }
      await this.assertProjectContractDirector(tx, projectId, actorUserId);
      const correction = await tx.contractTakeoverCorrection.findUnique({
        where: { id: correctionId }
      });
      if (
        !correction ||
        correction.projectId !== projectId ||
        correction.takeoverId !== takeover.id ||
        correction.correctionType !== "company_entity"
      ) {
        throw new Error("未找到该接管合同的主体更正，请刷新后重试");
      }
      if (correction.status !== "submitted") {
        throw new BadRequestException("主体更正已处理或发生变化，请刷新后重试");
      }
      if (correction.createdByUserId === actorUserId) {
        throw new ForbiddenException("主体更正提交人与确认人不能是同一人");
      }
      const contract = await tx.contract.findUnique({
        where: { id: takeover.contractId },
        select: { id: true, companyEntityId: true, companyEntityName: true }
      });
      if (!contract) throw new Error("未找到接管合同，请刷新后重试");
      let targetCompanyEntityId: string | null = null;
      if (decision === "approve") {
        const beforeSnapshot = isPlainObject(correction.beforeSnapshot)
          ? correction.beforeSnapshot
          : null;
        const frozenCompanyEntityId = nullableString(beforeSnapshot?.companyEntityId);
        if (contract.companyEntityId !== frozenCompanyEntityId) {
          throw new BadRequestException("主体更正已处理或发生变化，请刷新后重试");
        }
        targetCompanyEntityId = correction.targetCompanyEntityId;
        if (!targetCompanyEntityId) throw new Error("更正目标主体未冻结，请驳回后重新提交");
        await this.assertCompanyEntityExists(tx, targetCompanyEntityId);
      }
      const now = new Date();
      const claimed = await tx.contractTakeoverCorrection.updateMany({
        where: { id: correction.id, status: "submitted" },
        data: {
          status: decision === "approve" ? "confirmed" : "rejected",
          reviewedByUserId: actorUserId,
          reviewedAt: now,
          reviewComment
        }
      });
      if (claimed.count !== 1) {
        throw new BadRequestException("主体更正已处理或发生变化，请刷新后重试");
      }
      if (targetCompanyEntityId) {
        await tx.contract.update({
          where: { id: contract.id },
          data: { companyEntityId: targetCompanyEntityId }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: `contract_takeover.company_entity_correction.${decision === "approve" ? "confirm" : "reject"}`,
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          correctionId: correction.id,
          targetCompanyEntityId: correction.targetCompanyEntityId,
          reviewComment
        }
      });
      return {
        id: correction.id,
        status: decision === "approve" ? "confirmed" : "rejected",
        message: decision === "approve" ? "主体更正已确认" : "主体更正已驳回"
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException("主体更正已处理或发生变化，请刷新后重试");
      }
      throw error;
    }
  }

  async list(projectId: string, actorUserId?: string) {
    const takeovers = await this.prisma.contractTakeover.findMany({
      where: { projectId, takeoverStatus: { not: "abandoned" } },
      orderBy: { createdAt: "desc" }
    });

    return this.toReadModels(this.prisma, takeovers, actorUserId);
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

  async abandonDraft(
    projectId: string,
    takeoverId: string,
    input: AbandonContractTakeoverDto,
    actorUserId: string
  ) {
    const reason = input.reason?.trim() ?? "";
    if (input.action === "abandon_application" && !reason) {
      throw new BadRequestException("放弃历史接管申请必须填写原因");
    }
    return this.prisma.$transaction(async (tx) => {
      const [takeover] = await tx.$queryRaw<Array<NonNullable<Awaited<ReturnType<typeof tx.contractTakeover.findUnique>>>>>(Prisma.sql`
        SELECT * FROM "ContractTakeover"
        WHERE "id" = ${takeoverId} AND "projectId" = ${projectId}
        FOR UPDATE
      `);
      if (!takeover) throw new BadRequestException("未找到历史合同接管草稿，请刷新后重试");
      return this.closeTakeoverDraft(tx, takeover, input, actorUserId, reason);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async previewBatchAbandonment(projectId: string, batchId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.contractTakeoverBatch.findFirst({ where: { id: batchId, projectId } });
      if (!batch) throw new BadRequestException("未找到历史接管导入批次，请刷新后重试");
      const rows = await this.batchAbandonmentRows(tx, projectId, batch.id, actorUserId);
      const previewHash = this.batchAbandonmentHash(batch.id, rows);
      return {
        batchId: batch.id,
        batchNo: batch.batchNo,
        previewHash,
        total: rows.length,
        eligible: rows.filter((row) => row.eligible).length,
        blocked: rows.filter((row) => !row.eligible).length,
        rows
      };
    });
  }

  async applyBatchAbandonment(
    projectId: string,
    batchId: string,
    input: AbandonContractTakeoverBatchDto,
    actorUserId: string
  ) {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException("请填写批量放弃原因");
    return this.prisma.$transaction(async (tx) => {
      const [batch] = await tx.$queryRaw<Array<NonNullable<Awaited<ReturnType<typeof tx.contractTakeoverBatch.findUnique>>>>>(Prisma.sql`
        SELECT * FROM "ContractTakeoverBatch"
        WHERE "id" = ${batchId} AND "projectId" = ${projectId}
        FOR UPDATE
      `);
      if (!batch) throw new BadRequestException("未找到历史接管导入批次，请刷新后重试");
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ContractTakeover"
        WHERE "takeoverBatchId" = ${batch.id}
        ORDER BY "importRowNo" ASC NULLS LAST, "id" ASC
        FOR UPDATE
      `);
      const rows = await this.batchAbandonmentRows(tx, projectId, batch.id, actorUserId);
      if (this.batchAbandonmentHash(batch.id, rows) !== input.previewHash) {
        throw new ConflictException("批次草稿在预览后已发生变化，请重新预览");
      }
      const blocked = rows.filter((row) => !row.eligible);
      if (blocked.length) {
        throw new ConflictException("批次中仍有不能放弃的记录，请处理阻断项后重新预览");
      }
      for (const row of rows) {
        const takeover = await tx.contractTakeover.findUnique({ where: { id: row.id } });
        if (!takeover) throw new ConflictException("批次草稿已发生变化，请重新预览");
        await this.closeTakeoverDraft(tx, takeover, {
          expectedUpdatedAt: row.updatedAt,
          action: row.action
        }, actorUserId, reason);
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover_batch.drafts.abandon",
        businessType: "contract_takeover_batch",
        businessId: batch.id,
        metadata: { projectId, count: rows.length, previewHash: input.previewHash, reason }
      });
      return { batchId: batch.id, abandonedCount: rows.length, previewHash: input.previewHash };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

  async detail(projectId: string, takeoverId: string, actorUserId?: string) {
    const takeover = await this.getProjectTakeover(this.prisma, projectId, takeoverId);
    return this.toReadModelFromDatabase(this.prisma, takeover, actorUserId);
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

  async returnForSupplement(
    projectId: string,
    takeoverId: string,
    input: ReturnContractTakeoverForSupplementDto,
    actorUserId: string
  ) {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new Error("请填写退回补充原因");
    }

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (takeover.takeoverStatus !== "pending_review") {
        throw new Error("只有待复核的接管记录可以退回补充");
      }

      const updated = await tx.contractTakeover.update({
        where: { id: takeover.id },
        data: { takeoverStatus: "needs_supplement" }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.return_for_supplement",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          fromStatus: "pending_review",
          toStatus: "needs_supplement",
          reason
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

      await this.assertTakeoverPaymentStages(tx, takeover);

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

  async confirmChangeBaseline(
    projectId: string,
    takeoverId: string,
    actorUserId: string,
    input: ConfirmContractChangeBaselineDto
  ) {
    if (!input.currentPassword?.trim()) {
      throw new BadRequestException("确认历史变更基线需要当前登录密码");
    }
    if (!this.auth) throw new Error("系统暂不能确认当前密码，请稍后重试");
    const originalBaseAmountCents = parseMoneyCentsInput(
      input.originalSignedAmountCents,
      "原始签约含税金额",
      "原始签约含税金额必须是大于等于 0 的整数分值"
    );
    const cumulativeIncreaseCents = parseMoneyCentsInput(
      input.preTakeoverPositiveIncreaseCents,
      "接管前累计正向增项",
      "接管前累计正向增项必须是大于等于 0 的整数分值"
    );
    await this.auth.confirmPassword(actorUserId, input.currentPassword);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const [located] = await tx.$queryRaw<Array<{
        contractId: string;
        contractVersionId: string;
      }>>(Prisma.sql`
        SELECT "contractId", "contractVersionId"
        FROM "ContractTakeover"
        WHERE "id" = ${takeoverId} AND "projectId" = ${projectId}
      `);
      if (!located) throw new BadRequestException("未找到历史合同接管记录");

      const contractLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Contract" WHERE "id" = ${located.contractId} FOR UPDATE
      `);
      if (contractLocks.length !== 1) throw new BadRequestException("历史合同不存在或已失效");
      const [root] = await tx.$queryRaw<Array<{
        id: string;
        baseVersionId: string | null;
        changeType: string;
        status: string;
        effectiveAt: Date | null;
        pricingNature: string;
        amountLimitType: string;
        originalBaseAmountCents: bigint | null;
      }>>(Prisma.sql`
        SELECT "id", "baseVersionId", "changeType", "status", "effectiveAt",
               "pricingNature", "amountLimitType",
               "originalBaseAmountCents"
        FROM "ContractVersion"
        WHERE "id" = ${located.contractVersionId}
        FOR UPDATE
      `);
      const [takeover] = await tx.$queryRaw<Array<{
        id: string;
        takeoverStatus: string;
      }>>(Prisma.sql`
        SELECT "id", "takeoverStatus"
        FROM "ContractTakeover"
        WHERE "id" = ${takeoverId} AND "projectId" = ${projectId}
        FOR UPDATE
      `);
      const directorRows = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
        SELECT up."userId"
        FROM "UserPosition" up
        INNER JOIN "Position" p ON p."id" = up."positionId"
        INNER JOIN "User" u ON u."id" = up."userId"
        WHERE up."projectId" IS NULL
          AND up."userId" = ${actorUserId}
          AND p."key" = 'contract_director'
          AND u."isActive" = TRUE
        FOR SHARE OF up, p, u
      `);
      if (directorRows.length !== 1) {
        throw new ForbiddenException("只有公司级合同部主管可以确认历史变更基线");
      }
      if (!root || !takeover || root.baseVersionId !== null ||
          root.changeType !== "historical_takeover" ||
          takeover.takeoverStatus !== "confirmed" ||
          (root.status !== "effective" && root.status !== "superseded") ||
          root.effectiveAt === null) {
        throw new BadRequestException("只有已确认并生效的历史接管合同可以补录历史变更基线");
      }
      if (root.originalBaseAmountCents !== null) {
        throw new BadRequestException("历史变更基线已经确认，不能重复覆盖");
      }
      const unlimitedFramework = root.pricingNature === "framework" &&
        root.amountLimitType === "unlimited";
      if (!unlimitedFramework && originalBaseAmountCents <= 0n) {
        throw new BadRequestException("原始签约含税金额必须大于 0");
      }
      if (cumulativeIncreaseCents < 0n) {
        throw new BadRequestException("接管前累计正向增项不能小于 0");
      }
      const updated = await tx.contractVersion.updateMany({
        where: { id: root.id, originalBaseAmountCents: null },
        data: { originalBaseAmountCents, cumulativeIncreaseCents }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("历史变更基线已经确认，不能重复覆盖");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.change_baseline.confirm",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: located.contractId,
          contractVersionId: root.id,
          originalBaseAmountCents: originalBaseAmountCents.toString(),
          preTakeoverPositiveIncreaseCents: cumulativeIncreaseCents.toString()
        }
      });
      return {
        takeoverId: takeover.id,
        contractVersionId: root.id,
        changeBaselineConfirmed: true,
        originalBaseAmountCents: originalBaseAmountCents.toString(),
        preTakeoverPositiveIncreaseCents: cumulativeIncreaseCents.toString()
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException("历史变更基线正在被更新，请刷新后重试");
      }
      throw error;
    }
  }

  private isSerializationConflict(error: unknown) {
    return Boolean(
      error && typeof error === "object" && "code" in error &&
      (error.code === "P2034" ||
        (error.code === "P2010" && "meta" in error && error.meta &&
          typeof error.meta === "object" && "code" in error.meta && error.meta.code === "40001"))
    );
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

  private async assertCompanyEntityExists(
    client: Pick<Prisma.TransactionClient, "companyEntity">,
    companyEntityId: string | null | undefined
  ) {
    if (!companyEntityId) return;
    const companyEntity = await client.companyEntity.findUnique({
      where: { id: companyEntityId },
      select: { id: true }
    });
    if (!companyEntity) {
      throw new BadRequestException("所选我方签约主体不存在，请重新选择");
    }
  }

  private async assertProjectContractStaff(
    client: Pick<Prisma.TransactionClient, "userPosition" | "position" | "projectMember">,
    projectId: string,
    actorUserId: string
  ) {
    const [assignments, memberships] = await Promise.all([
      client.userPosition.findMany({
        where: {
          userId: actorUserId,
          OR: [{ projectId: null }, { projectId }]
        },
        select: { positionId: true }
      }),
      client.projectMember.findMany({
        where: { projectId, userId: actorUserId },
        select: { positionKey: true }
      })
    ]);
    const positions = assignments.length
      ? await client.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } },
          select: { key: true }
        })
      : [];
    const isContractStaff =
      positions.some((position) => position.key === "contract_staff") ||
      memberships.some((membership) => membership.positionKey === "contract_staff");
    if (!isContractStaff) {
      throw new ForbiddenException("仅该项目合同员可以发起历史主体更正");
    }
  }

  private async assertProjectContractDirector(
    client: Pick<Prisma.TransactionClient, "userPosition" | "position" | "projectMember">,
    projectId: string,
    actorUserId: string
  ) {
    const [assignments, memberships] = await Promise.all([
      client.userPosition.findMany({
        where: {
          userId: actorUserId,
          OR: [{ projectId: null }, { projectId }]
        },
        select: { positionId: true }
      }),
      client.projectMember.findMany({
        where: { projectId, userId: actorUserId },
        select: { positionKey: true }
      })
    ]);
    const positions = assignments.length
      ? await client.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } },
          select: { key: true }
        })
      : [];
    const isContractDirector =
      positions.some((position) => position.key === "contract_director") ||
      memberships.some((membership) => membership.positionKey === "contract_director");
    if (!isContractDirector) {
      throw new ForbiddenException("仅该项目合同部主管可以处理历史主体更正");
    }
  }

  private async toReadModels(
    client: TakeoverReadClient,
    takeovers: ContractTakeoverRecord[],
    actorUserId?: string
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
    const paymentTermsStageClient = (client as unknown as {
      paymentTermsStage?: TakeoverReadClient["paymentTermsStage"];
    }).paymentTermsStage;
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
    const pricingClient = client as unknown as {
      contractBill?: ReadClientFindMany<HistoricalContractBillRecord>;
      contractBillRow?: ReadClientFindMany<HistoricalContractBillRowRecord>;
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
          companyEntityId: true,
          companyEntityName: true,
          contractTypeKey: true
        }
      }),
      client.contractVersion.findMany({
        where: { id: { in: contractVersionIds } },
        select: {
          id: true,
          amountCents: true,
          originalBaseAmountCents: true,
          cumulativeIncreaseCents: true,
          invoiceType: true,
          taxMode: true,
          defaultTaxRatePercent: true,
          taxFactStatus: true,
          taxFactSource: true,
          taxFactExplanation: true
        }
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
    const paymentStages: HistoricalPaymentTermsStageRecord[] =
      typeof paymentTermsStageClient?.findMany === "function"
        ? await paymentTermsStageClient.findMany({
            where: { paymentTermsVersionId: { in: paymentTermsVersionIds } },
            orderBy: [{ paymentTermsVersionId: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              paymentTermsVersionId: true,
              name: true,
              stageType: true,
              basis: true,
              ratioBps: true,
              fixedAmountCents: true,
              triggerAnchor: true,
              dueDays: true,
              requiresInvoice: true,
              allowsEarlyPayment: true,
              allowsInstallments: true
            }
          })
        : [];
    const contractBills =
      typeof pricingClient.contractBill?.findMany === "function"
        ? await pricingClient.contractBill.findMany({
            where: { contractVersionId: { in: contractVersionIds } },
            orderBy: [{ contractVersionId: "asc" }, { billKey: "asc" }],
            select: {
              id: true,
              contractVersionId: true,
              billKey: true,
              name: true
            }
          })
        : [];
    const contractBillRows =
      typeof pricingClient.contractBillRow?.findMany === "function" && contractBills.length
        ? await pricingClient.contractBillRow.findMany({
            where: { contractBillId: { in: contractBills.map((bill) => bill.id) } },
            orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
            select: {
              contractBillId: true,
              rowKey: true,
              itemCode: true,
              itemName: true,
              specification: true,
              unit: true,
              quantity: true,
              unitPrice: true,
              taxRate: true,
              pricingFactStatus: true,
              isProvisional: true,
              settlementBasis: true
            }
          })
        : [];
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
      correctionRecords.flatMap((record) => [
        record.responsibleUserId,
        record.createdByUserId,
        record.submittedByUserId,
        record.reviewedByUserId
      ].filter((id): id is string => typeof id === "string" && Boolean(id)))
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
    const billById = new Map(contractBills.map((bill) => [bill.id, bill]));
    const pricingItemsByVersionId = new Map<string, HistoricalPricingItemReadModel[]>();
    for (const row of contractBillRows) {
      const bill = billById.get(row.contractBillId);
      if (!bill) continue;
      pricingItemsByVersionId.set(bill.contractVersionId, [
        ...(pricingItemsByVersionId.get(bill.contractVersionId) ?? []),
        {
          billKey: bill.billKey,
          billName: bill.name,
          rowKey: row.rowKey,
          itemCode: row.itemCode,
          itemName: row.itemName,
          specification: row.specification,
          unit: row.unit,
          estimatedQuantity: row.quantity?.toString() ?? null,
          taxInclusiveUnitPrice: row.unitPrice?.toString() ?? null,
          taxRatePercent: row.taxRate?.toString() ?? null,
          pricingFactStatus: row.pricingFactStatus,
          isProvisional: row.isProvisional,
          settlementBasis: row.settlementBasis
        }
      ]);
    }
    const termsById = new Map(terms.map((term) => [term.id, term]));
    const paymentStagesByTermsId = new Map<string, HistoricalTakeoverDirectPaymentStageReadModel[]>();
    for (const stage of paymentStages) {
      if (
        stage.stageType === "advance" ||
        stage.basis !== "contract_amount" ||
        stage.triggerAnchor !== "contract_effective"
      ) {
        continue;
      }
      paymentStagesByTermsId.set(stage.paymentTermsVersionId, [
        ...(paymentStagesByTermsId.get(stage.paymentTermsVersionId) ?? []),
        {
          id: stage.id,
          name: stage.name,
          ratioBps: stage.ratioBps,
          fixedAmountCents: stage.fixedAmountCents?.toString() ?? null,
          dueDays: stage.dueDays,
          requiresInvoice: stage.requiresInvoice,
          allowsEarlyPayment: stage.allowsEarlyPayment,
          allowsInstallments: stage.allowsInstallments
        }
      ]);
    }
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
        companyEntityId: contractById.get(takeover.contractId)?.companyEntityId ?? null,
        companyEntityName: contractById.get(takeover.contractId)?.companyEntityName ?? null,
        contractTypeKey: contractById.get(takeover.contractId)?.contractTypeKey ?? null,
        amountCents: versionById.get(takeover.contractVersionId)?.amountCents ?? 0n,
        contractVersion: versionById.get(takeover.contractVersionId) ?? null,
        pricingItems: pricingItemsByVersionId.get(takeover.contractVersionId) ?? [],
        paymentTermsOriginalText: termsById.get(takeover.paymentTermsVersionId)?.originalText ?? "",
        paymentStages: paymentStagesByTermsId.get(takeover.paymentTermsVersionId) ?? [],
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
            status: correction.status,
            statusLabel: correctionStatusLabel(correction.status),
            targetCompanyEntityId: correction.targetCompanyEntityId,
            reason: correction.reason,
            beforeSummary: correctionBeforeSummary(correction.beforeSnapshot),
            afterSummary: correctionAfterSummary(correction.afterSnapshot),
            responsibleUserName:
              userNameById.get(correction.responsibleUserId) ?? "更正责任人未读取",
            createdByName: userNameById.get(correction.createdByUserId) ?? "更正记录人未读取",
            submittedByName:
              userNameById.get(correction.submittedByUserId ?? correction.createdByUserId) ??
              "更正提交人未读取",
            submittedAt: correction.submittedAt ?? correction.createdAt,
            reviewedByName: correction.reviewedByUserId
              ? userNameById.get(correction.reviewedByUserId) ?? "更正确认人未读取"
              : null,
            reviewedAt: correction.reviewedAt,
            reviewComment: correction.reviewComment,
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
      }, actorUserId)
    );
  }

  private async toReadModelFromDatabase(
    client: TakeoverReadClient,
    takeover: ContractTakeoverRecord,
    actorUserId?: string
  ) {
    const [readModel] = await this.toReadModels(client, [takeover], actorUserId);
    return readModel;
  }

  private toReadModel(
    takeover: ContractTakeoverRecord,
    contract: {
      contractNo: string;
      contractName: string;
      counterparty: string;
      companyEntityId: string | null;
      companyEntityName: string | null;
      contractTypeKey?: string | null;
      amountCents: bigint;
      contractVersion?: HistoricalContractVersionFacts | null;
      pricingItems?: HistoricalPricingItemReadModel[];
      paymentTermsOriginalText: string;
      paymentStages?: HistoricalTakeoverDirectPaymentStageReadModel[];
      batchNo?: string | null;
      responsibleUserName?: string | null;
      evidenceFiles: ContractTakeoverEvidenceFileReadModel[];
      corrections: ContractTakeoverCorrectionReadModel[];
      postConfirmationVerification: ContractTakeoverPostConfirmationVerificationReadModel;
    },
    actorUserId?: string
  ): ContractTakeoverBusinessReadModel {
    const evidenceChecklist = takeoverEvidenceChecklist(takeover, contract.evidenceFiles);
    const invoiceType = contract.contractVersion?.invoiceType ?? null;
    const defaultTaxRatePercent =
      contract.contractVersion?.defaultTaxRatePercent?.toString() ?? null;
    const pricingItems = contract.pricingItems ?? [];
    const changeBaselineConfirmed = contract.contractVersion?.originalBaseAmountCents != null;

    const terminal = takeover.takeoverStatus === "confirmed" || Boolean(takeover.confirmedAt);
    const allowed = ["draft", "needs_supplement", "pending_review"].includes(takeover.takeoverStatus);
    const owns = Boolean(actorUserId) && (
      takeover.createdByUserId === actorUserId || takeover.responsibleUserId === actorUserId
    );
    const downstream = contract.postConfirmationVerification;
    const lifecycleBlockers = [
      ...(takeover.takeoverStatus === "abandoned" ? ["接管记录已放弃"] : []),
      ...(terminal ? ["接管已确认"] : []),
      ...(!terminal && !allowed && takeover.takeoverStatus !== "abandoned" ? ["接管状态不能放弃"] : []),
      ...(downstream.newSettlementCount ? ["存在关联结算"] : []),
      ...(downstream.paymentRequestCount ? ["存在关联付款"] : []),
      ...(!owns && actorUserId ? ["当前账号不是该接管记录责任人"] : []),
      ...(!actorUserId ? ["未提供当前操作人"] : [])
    ];
    const pristine = takeover.takeoverStatus === "draft" && !takeover.submittedAt &&
      contract.evidenceFiles.length === 0 && contract.corrections.length === 0;
    const lifecycleKind = takeover.takeoverStatus === "abandoned" || terminal
      ? "formal_record" : pristine ? "pristine_draft" : "approval_draft";
    const availableActions = lifecycleKind === "formal_record" ? [] : [{
      key: pristine ? "delete_pristine_draft" : "abandon_application",
      label: pristine ? "删除草稿" : "放弃历史接管申请",
      kind: "danger" as const,
      enabled: lifecycleBlockers.length === 0,
      disabledReason: lifecycleBlockers.length ? lifecycleBlockers.join("；") : null,
      ...(pristine ? {} : { requiresComment: true })
    }];

    return {
      id: takeover.id,
      batchNo: contract.batchNo ?? null,
      importRowNo: takeover.importRowNo ?? null,
      contractNo: contract.contractNo,
      contractName: contract.contractName,
      counterparty: contract.counterparty,
      companyEntityId: contract.companyEntityId,
      companyEntityName: contract.companyEntityName,
      contractTypeKey: contract.contractTypeKey ?? null,
      amountCents: moneyString(contract.amountCents),
      paymentTermsOriginalText: contract.paymentTermsOriginalText,
      paymentStages: contract.paymentStages ?? [],
      invoiceType,
      taxMode: contract.contractVersion?.taxMode ?? "single_rate",
      defaultTaxRatePercent,
      taxFactStatus: contract.contractVersion?.taxFactStatus ?? "unconfirmed",
      taxFactSource: contract.contractVersion?.taxFactSource ?? null,
      taxFactExplanation: contract.contractVersion?.taxFactExplanation ?? null,
      taxFactMissingFields: [
        ...(invoiceType ? [] : ["发票类型"]),
        ...(defaultTaxRatePercent ? [] : ["默认税率"]),
        ...pricingItems
          .filter((item) => item.taxInclusiveUnitPrice === null)
          .map((item) => `清单项目“${item.itemName}”含税单价`)
      ],
      pricingItems,
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
      changeBaselineConfirmed,
      originalBaseAmountCents: changeBaselineConfirmed
        ? moneyString(contract.contractVersion!.originalBaseAmountCents!)
        : null,
      preTakeoverPositiveIncreaseCents: changeBaselineConfirmed
        ? moneyString(contract.contractVersion?.cumulativeIncreaseCents ?? 0n)
        : null,
      evidenceChecklist,
      evidenceFiles: contract.evidenceFiles,
      corrections: contract.corrections,
      postConfirmationVerification: contract.postConfirmationVerification,
      lifecycleKind,
      lifecycleBlockers,
      availableActions,
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

  private async batchAbandonmentRows(
    tx: Prisma.TransactionClient,
    projectId: string,
    batchId: string,
    actorUserId: string
  ): Promise<Array<{
    id: string;
    contractNo: string;
    contractName: string;
    importRowNo: number | null;
    updatedAt: string;
    action: "delete_pristine_draft" | "abandon_application";
    eligible: boolean;
    blockers: string[];
  }>> {
    const takeovers = await tx.contractTakeover.findMany({
      where: { projectId, takeoverBatchId: batchId },
      orderBy: [{ importRowNo: "asc" }, { id: "asc" }]
    });
    const contractReader = (tx as unknown as {
      contract?: { findMany(args: unknown): Promise<Array<{
        id: string; code: string | null; temporaryCode: string | null; name: string;
      }>> }
    }).contract;
    const contracts = takeovers.length && contractReader ? await contractReader.findMany({
      where: { id: { in: unique(takeovers.map((takeover) => takeover.contractId)) } },
      select: { id: true, code: true, temporaryCode: true, name: true }
    }) : [];
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const rows = [];
    for (const takeover of takeovers) {
      const facts = await this.takeoverAbandonmentFacts(tx, takeover);
      const owns = takeover.createdByUserId === actorUserId ||
        takeover.responsibleUserId === actorUserId;
      const blockers = [
        ...facts.blockers,
        ...(!owns ? ["当前账号不是该接管记录责任人"] : [])
      ];
      rows.push({
        id: takeover.id,
        contractNo: contractById.get(takeover.contractId)?.code ??
          contractById.get(takeover.contractId)?.temporaryCode ?? takeover.contractId,
        contractName: contractById.get(takeover.contractId)?.name ?? "合同名称未读取",
        importRowNo: takeover.importRowNo,
        updatedAt: takeover.updatedAt.toISOString(),
        action: facts.action,
        eligible: blockers.length === 0,
        blockers
      });
    }
    return rows;
  }

  private batchAbandonmentHash(batchId: string, rows: Array<{
    id: string;
    updatedAt: string;
    action: string;
    eligible: boolean;
    blockers: string[];
  }>) {
    const atomicRows = rows.map(({ id, updatedAt, action, eligible, blockers }) => ({
      id, updatedAt, action, eligible, blockers
    }));
    return createHash("sha256")
      .update(JSON.stringify(stableObject({ batchId, rows: atomicRows })))
      .digest("hex");
  }

  private async takeoverAbandonmentFacts(
    tx: Prisma.TransactionClient,
    takeover: {
      id: string;
      contractId: string;
      contractVersionId: string;
      takeoverStatus: string;
      submittedAt: Date | null;
      confirmedAt: Date | null;
    }
  ) {
    const [evidenceCount, correctionCount, settlementCount, paymentCount] = await Promise.all([
      tx.archiveRecord.count({
        where: { businessType: "contract_takeover", businessId: takeover.id }
      }),
      tx.contractTakeoverCorrection.count({ where: { takeoverId: takeover.id } }),
      tx.settlement.count({ where: { contractVersionId: takeover.contractVersionId } }),
      tx.paymentRequest.count({ where: { contractVersionId: takeover.contractVersionId } })
    ]);
    const terminal = takeover.takeoverStatus === "confirmed" || Boolean(takeover.confirmedAt);
    const allowed = ["draft", "needs_supplement", "pending_review"].includes(
      takeover.takeoverStatus
    );
    const blockers = [
      ...(takeover.takeoverStatus === "abandoned" ? ["接管记录已放弃"] : []),
      ...(terminal ? ["接管已确认"] : []),
      ...(!terminal && !allowed && takeover.takeoverStatus !== "abandoned"
        ? ["接管状态不能放弃"]
        : []),
      ...(settlementCount ? ["存在关联结算"] : []),
      ...(paymentCount ? ["存在关联付款"] : [])
    ];
    const pristine = takeover.takeoverStatus === "draft" && !takeover.submittedAt &&
      evidenceCount === 0 && correctionCount === 0;
    return {
      action: pristine ? "delete_pristine_draft" as const : "abandon_application" as const,
      blockers,
      evidenceCount
    };
  }

  private async closeTakeoverDraft(
    tx: Prisma.TransactionClient,
    takeover: NonNullable<Awaited<ReturnType<Prisma.TransactionClient["contractTakeover"]["findUnique"]>>>,
    input: { expectedUpdatedAt: string; action: "delete_pristine_draft" | "abandon_application" },
    actorUserId: string,
    reason: string
  ) {
    if (takeover.createdByUserId !== actorUserId && takeover.responsibleUserId !== actorUserId) {
      throw new ForbiddenException("只有接管记录创建人或当前责任人可以删除草稿或放弃申请");
    }
    if (takeover.takeoverStatus === "abandoned") {
      return { takeoverId: takeover.id, status: "abandoned", idempotent: true };
    }
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (takeover.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new ConflictException("历史接管草稿已被更新，请刷新后重试");
    }
    const facts = await this.takeoverAbandonmentFacts(tx, takeover);
    if (facts.blockers.length) {
      throw new ConflictException(`当前接管记录不能放弃：${facts.blockers.join("、")}`);
    }
    if (input.action !== facts.action) {
      throw new ConflictException(
        facts.action === "delete_pristine_draft"
          ? "当前接管记录仍是纯净草稿，请刷新后使用“删除草稿”"
          : "当前接管记录已留下业务证据，只能放弃申请"
      );
    }
    if (facts.action === "abandon_application" && !reason) {
      throw new BadRequestException("放弃历史接管申请必须填写原因");
    }
    const now = new Date();
    const updated = await tx.contractTakeover.updateMany({
      where: { id: takeover.id, takeoverStatus: takeover.takeoverStatus, updatedAt: expectedUpdatedAt },
      data: {
        takeoverStatus: "abandoned",
        abandonedAt: now,
        abandonedByUserId: actorUserId,
        abandonReason: facts.action === "abandon_application" ? reason : null
      }
    });
    if (updated.count !== 1) {
      throw new ConflictException("历史接管草稿已被其他操作处理，请刷新后重试");
    }
    const closedVersion = await tx.contractVersion.updateMany({
      where: {
        id: takeover.contractVersionId,
        status: { in: ["draft", "approval_rejected"] },
        abandonedAt: null
      },
      data: {
        status: "abandoned",
        abandonedAt: now,
        abandonedByUserId: actorUserId,
        abandonReason: facts.action === "abandon_application" ? reason : null
      }
    });
    const closedTerms = await tx.paymentTermsVersion.updateMany({
      where: { id: takeover.paymentTermsVersionId, status: "draft" },
      data: { status: "voided" }
    });
    if (closedVersion.count !== 1 || closedTerms.count !== 1) {
      throw new ConflictException(
        "接管生成的合同草稿或付款条款已形成其他状态，不能放弃，请刷新后核对"
      );
    }
    await this.audit.record(tx, {
      actorUserId,
      action: facts.action === "delete_pristine_draft"
        ? "contract_takeover.draft.delete"
        : "contract_takeover.application.abandon",
      businessType: "contract_takeover",
      businessId: takeover.id,
      metadata: {
        projectId: takeover.projectId,
        contractId: takeover.contractId,
        contractVersionId: takeover.contractVersionId,
        previousStatus: takeover.takeoverStatus,
        evidenceCount: facts.evidenceCount,
        reason: facts.action === "abandon_application" ? reason : null
      }
    });
    return {
      takeoverId: takeover.id,
      status: "abandoned",
      action: facts.action,
      abandonedAt: now,
      idempotent: false
    };
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
    const amountValue = safePrecheckMoneyValue(row["amountCents"], "合同金额");
    const amountCents = amountValue === null ? null : moneyTextValue(row["amountCents"]);
    const signedAt = stringValue(row["signedAt"]);
    const takeoverLevel = takeoverLevelInputValue(row["takeoverLevel"]);
    const lifecycleStatus = stringValue(row["lifecycleStatus"]);
    const contractTypeKey = stringValue(row["contractTypeKey"]);
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
    const rawPricingItems = Array.isArray(row["pricingItems"]) ? row["pricingItems"] : [];
    const unlimitedFramework = amountValue === 0n && rawPricingItems.length > 0;
    if (amountValue === null || amountValue < 0n || (amountValue === 0n && !unlimitedFramework)) {
      issues.push(
        issue(
          rowNo,
          "amountCents",
          "error",
          "合同金额必须大于 0；无总价框架合同可填写 0，但必须提供计价清单"
        )
      );
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
    if (contractTypeKey === "generic_contract") {
      issues.push(
        issue(
          rowNo,
          "contractTypeKey",
          "error",
          "通用合同必须逐项核对并手工录入直接付款阶段，请改用单合同补录"
        )
      );
    }

    for (const field of MONEY_FIELDS) {
      const value = isBlankInput(row[field])
        ? 0n
        : safePrecheckMoneyValue(row[field], MONEY_FIELD_LABELS[field]);
      if (value === null) {
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
    const invoiceType = stringValue(row["invoiceType"]);
    const taxMode = stringValue(row["taxMode"]) || "single_rate";
    const defaultTaxRatePercent = stringValue(row["defaultTaxRatePercent"]);
    if (invoiceType && !["vat_general", "vat_special"].includes(invoiceType)) {
      issues.push(
        issue(
          rowNo,
          "invoiceType",
          "error",
          "发票类型请选择增值税普通发票或增值税专用发票"
        )
      );
    } else if (!invoiceType) {
      issues.push(
        issue(
          rowNo,
          "invoiceType",
          "warning",
          "原合同未明确发票类型；允许接管，但后续结算提交前必须补录并确认"
        )
      );
    }
    if (!["single_rate", "multiple_rate"].includes(taxMode)) {
      issues.push(issue(rowNo, "taxMode", "error", "计税模式请选择单一税率或特殊多税率"));
    }
    let normalizedDefaultRate: string | null = null;
    if (defaultTaxRatePercent) {
      try {
        normalizedDefaultRate = normalizeTakeoverTaxRate(defaultTaxRatePercent, "默认税率");
      } catch (error) {
        issues.push(
          issue(
            rowNo,
            "defaultTaxRatePercent",
            "error",
            error instanceof Error ? error.message : "默认税率格式不正确"
          )
        );
      }
    } else {
      issues.push(
        issue(
          rowNo,
          "defaultTaxRatePercent",
          "warning",
          "原合同未明确税率；允许接管，但后续结算提交前必须补录并确认"
        )
      );
    }
    const pricingItems = rawPricingItems as HistoricalPricingItemDto[];
    try {
      const normalizedPricingItems = normalizeHistoricalPricingItems(
        pricingItems,
        taxMode === "multiple_rate" ? "multiple_rate" : "single_rate",
        normalizedDefaultRate
      );
      const missingPriceCount = normalizedPricingItems.filter(
        (item) => item.unitPrice === null
      ).length;
      if (missingPriceCount) {
        issues.push(
          issue(
            rowNo,
            "pricingItems",
            "warning",
            `${missingPriceCount} 条历史清单项目含税单价未明确；只阻断包含这些项目的结算提交`
          )
        );
      }
    } catch (error) {
      issues.push(
        issue(
          rowNo,
          "pricingItems",
          "error",
          error instanceof Error ? error.message : "历史计价清单格式不正确"
        )
      );
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
    const amountCents = parseMoneyCentsInput(
      input.amountCents,
      "合同金额",
      "合同金额必须大于 0"
    );
    const inferredUnlimitedFramework =
      amountCents === 0n &&
      Array.isArray(input.pricingItems) &&
      input.pricingItems.length > 0;
    if (amountCents < 0n || (amountCents === 0n && !inferredUnlimitedFramework)) {
      throw new BadRequestException(
        "合同金额必须大于 0；无总价框架合同可填写 0，但必须提供计价清单"
      );
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
      MONEY_FIELDS.map((field) => [
        field,
        parseMoneyCentsInput(
          input[field] ?? "0",
          MONEY_FIELD_LABELS[field],
          `${MONEY_FIELD_LABELS[field]}必须填写 0 或更大的金额`
        )
      ])
    ) as Record<(typeof MONEY_FIELDS)[number], bigint>;
    const reviewComment = input.reviewComment?.trim() || null;
    const takeoverLevelAdjustmentReason = input.takeoverLevelAdjustmentReason?.trim() || null;
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
    if (takeoverLevel !== suggestedLevel && !takeoverLevelAdjustmentReason && !reviewComment) {
      throw new Error("接管等级与系统建议不一致，请填写等级调整说明");
    }
    const defaultTaxRatePercent = input.defaultTaxRatePercent?.trim()
      ? normalizeTakeoverTaxRate(input.defaultTaxRatePercent, "默认税率")
      : null;
    const taxMode = input.taxMode ?? "single_rate";
    const pricingItems = normalizeHistoricalPricingItems(
      input.pricingItems ?? [],
      taxMode,
      defaultTaxRatePercent
    );

    return {
      ...input,
      ...money,
      amountCents,
      pricingNature: inferredUnlimitedFramework ? "framework" : "fixed_total",
      amountLimitType: inferredUnlimitedFramework ? "unlimited" : "capped",
      amountSource: inferredUnlimitedFramework ? "bill_sum" : "manual",
      code: input.code.trim(),
      name: input.name.trim(),
      counterparty: input.counterparty.trim(),
      contractTypeKey: input.contractTypeKey?.trim() || undefined,
      companyEntityId: input.companyEntityId?.trim() || undefined,
      companyEntityName: input.companyEntityName?.trim() || undefined,
      takeoverLevel: takeoverLevel as ContractTakeoverLevel,
      suggestedTakeoverLevel: suggestedLevel,
      takeoverLevelAdjustmentReason:
        takeoverLevel === suggestedLevel ? null : takeoverLevelAdjustmentReason ?? reviewComment,
      signedAt,
      invoiceType: input.invoiceType ?? null,
      taxMode,
      defaultTaxRatePercent,
      taxFactSource: input.taxFactSource ?? null,
      taxFactExplanation: input.taxFactExplanation?.trim() || null,
      taxFactEvidenceFileId: input.taxFactEvidenceFileId?.trim() || null,
      taxFactsProvided: [
        input.invoiceType,
        input.taxMode,
        input.defaultTaxRatePercent,
        input.taxFactSource,
        input.taxFactExplanation,
        input.taxFactEvidenceFileId,
        input.pricingItems
      ].some((value) => value !== undefined),
      pricingItemsProvided: input.pricingItems !== undefined,
      pricingItems,
      takeoverCutoffDate,
      responsibleUserId: input.responsibleUserId?.trim() || null,
      reviewComment,
      acceptanceConclusion: input.acceptanceConclusion?.trim() || null
    };
  }

  private async replaceHistoricalPricingItems(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    items: HistoricalPricingItem[]
  ) {
    const existingBills = await tx.contractBill.findMany({
      where: { contractVersionId },
      select: { id: true }
    });
    if (existingBills.length) {
      await tx.contractBillRow.deleteMany({
        where: { contractBillId: { in: existingBills.map((bill) => bill.id) } }
      });
      await tx.contractBill.deleteMany({ where: { contractVersionId } });
    }
    if (!items.length) return;

    const bills = new Map<string, HistoricalPricingItem[]>();
    for (const item of items) {
      bills.set(item.billKey, [...(bills.get(item.billKey) ?? []), item]);
    }
    for (const [billKey, rows] of bills) {
      const totals = rows.reduce(
        (sum, row) => ({
          taxInclusiveAmountCents:
            sum.taxInclusiveAmountCents + (row.taxInclusiveAmountCents ?? 0n),
          taxExclusiveAmountCents:
            sum.taxExclusiveAmountCents + (row.taxExclusiveAmountCents ?? 0n),
          taxAmountCents: sum.taxAmountCents + (row.taxAmountCents ?? 0n)
        }),
        {
          taxInclusiveAmountCents: 0n,
          taxExclusiveAmountCents: 0n,
          taxAmountCents: 0n
        }
      );
      const bill = await tx.contractBill.create({
        data: {
          contractVersionId,
          billKey,
          name: rows[0]?.billName ?? billKey,
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          schemaSnapshot: {
            historicalTakeover: true,
            columns: [
              "itemCode",
              "itemName",
              "specification",
              "unit",
              "quantity",
              "unitPrice",
              "taxRate"
            ]
          } as Prisma.InputJsonValue,
          ...totals
        }
      });
      await tx.contractBillRow.createMany({
        data: rows.map((row, index) => ({
          contractBillId: bill.id,
          rowKey: row.rowKey,
          sortOrder: index + 1,
          itemCode: row.itemCode,
          itemName: row.itemName,
          specification: row.specification,
          unit: row.unit,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          taxRate: row.taxRatePercent,
          taxRateSource: row.taxRateSource,
          pricingFactStatus: "unconfirmed",
          precisionPolicy: "two_decimal",
          taxInclusiveAmountCents: row.taxInclusiveAmountCents,
          taxExclusiveAmountCents: row.taxExclusiveAmountCents,
          taxAmountCents: row.taxAmountCents,
          isProvisional: row.isProvisional,
          settlementBasis: row.settlementBasis,
          customData: {
            historicalTakeover: true,
            pricingFactStatus: "unconfirmed"
          } as Prisma.InputJsonValue
        }))
      });
    }
  }

  private importRowToCreateInput(row: Record<string, unknown>): CreateContractTakeoverDto {
    return {
      code: stringValue(row["code"]),
      name: stringValue(row["name"]),
      counterparty: stringValue(row["counterparty"]),
      contractTypeKey: stringValue(row["contractTypeKey"]) || undefined,
      companyEntityId: stringValue(row["companyEntityId"]) || undefined,
      companyEntityName: stringValue(row["companyEntityName"]) || undefined,
      invoiceType: optionalInvoiceType(row["invoiceType"]),
      taxMode: optionalTaxMode(row["taxMode"]),
      defaultTaxRatePercent: stringValue(row["defaultTaxRatePercent"]) || undefined,
      taxFactSource: optionalTaxFactSource(row["taxFactSource"]),
      taxFactExplanation: stringValue(row["taxFactExplanation"]) || undefined,
      pricingItems: Array.isArray(row["pricingItems"])
        ? row["pricingItems"] as HistoricalPricingItemDto[]
        : undefined,
      amountCents: moneyTextValue(row["amountCents"]) ?? "0",
      signedAt: stringValue(row["signedAt"]),
      takeoverLevel: takeoverLevelInputValue(row["takeoverLevel"]) as ContractTakeoverLevel,
      lifecycleStatus: stringValue(row["lifecycleStatus"]) as ContractLifecycleStatus,
      paymentTermsOriginalText: stringValue(row["paymentTermsOriginalText"]),
      historicalSettledCents: moneyTextValue(row["historicalSettledCents"]) ?? "0",
      historicalApprovalPendingPaymentCents:
        moneyTextValue(row["historicalApprovalPendingPaymentCents"]) ?? "0",
      historicalApprovedPendingPaymentCents:
        moneyTextValue(row["historicalApprovedPendingPaymentCents"]) ?? "0",
      historicalPaidCents: moneyTextValue(row["historicalPaidCents"]) ?? "0",
      historicalProxyPaidCents: moneyTextValue(row["historicalProxyPaidCents"]) ?? "0",
      historicalAdvancePaidCents: moneyTextValue(row["historicalAdvancePaidCents"]) ?? "0",
      historicalAdvanceDeductedCents: moneyTextValue(row["historicalAdvanceDeductedCents"]) ?? "0",
      historicalRetentionWithheldCents: moneyTextValue(row["historicalRetentionWithheldCents"]) ?? "0",
      historicalRetentionReleasedCents: moneyTextValue(row["historicalRetentionReleasedCents"]) ?? "0",
      otherConfirmedOccupancyCents: moneyTextValue(row["otherConfirmedOccupancyCents"]) ?? "0",
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

  private takeoverPaymentStages(
    paymentTermsVersionId: string,
    contractTypeKey: string | undefined,
    stages: CreateContractTakeoverDto["paymentStages"],
    originalText?: string
  ): Prisma.PaymentTermsStageCreateManyInput[] {
    const normalizedType = contractTypeKey?.trim() ?? "";
    if (normalizedType !== "generic_contract") {
      if (stages?.length) {
        throw new BadRequestException("该合同类型必须依据生效结算付款，不能录入直接付款阶段");
      }
      return [
        {
          id: randomUUID(),
          ...this.takeoverInitialSettlementStage(paymentTermsVersionId, originalText)
        }
      ];
    }
    if (!stages?.length) {
      throw new BadRequestException("通用合同历史接管必须按原合同条款录入至少一个直接付款阶段");
    }

    return stages.map((stage, index) => {
      const name = stage.name?.trim();
      if (!name) {
        throw new BadRequestException(`第 ${index + 1} 个付款阶段缺少名称`);
      }
      const hasRatio = stage.ratioBps !== undefined;
      const hasFixedAmount = stage.fixedAmountCents !== undefined;
      if (hasRatio === hasFixedAmount) {
        throw new BadRequestException(`付款阶段“${name}”必须在付款比例和固定金额中仅选一项`);
      }
      if (
        hasRatio &&
        (!Number.isInteger(stage.ratioBps) || stage.ratioBps! <= 0 || stage.ratioBps! > 10000)
      ) {
        throw new BadRequestException(`付款阶段“${name}”的付款比例必须在 1 到 10000 之间`);
      }
      const fixedAmountCents = hasFixedAmount
        ? parseMoneyCentsInput(
            stage.fixedAmountCents!,
            `付款阶段“${name}”固定金额`,
            `付款阶段“${name}”的固定金额必须大于 0`
          )
        : null;
      if (fixedAmountCents !== null && fixedAmountCents <= 0n) {
        throw new BadRequestException(`付款阶段“${name}”的固定金额必须大于 0`);
      }
      if (!Number.isInteger(stage.dueDays) || stage.dueDays < 0) {
        throw new BadRequestException(`付款阶段“${name}”的付款期限必须是 0 或更大的整数天`);
      }

      return {
        id: randomUUID(),
        paymentTermsVersionId,
        name,
        stageType: "progress",
        basis: "contract_amount",
        ratioBps: hasRatio ? stage.ratioBps : null,
        fixedAmountCents,
        triggerAnchor: "contract_effective",
        triggerEvent: `${name}：合同生效后按原合同条款申请`,
        dueDays: stage.dueDays,
        requiresInvoice: stage.requiresInvoice,
        allowsEarlyPayment: stage.allowsEarlyPayment,
        allowsInstallments: stage.allowsInstallments,
        originalText: originalText?.trim() || name
      };
    });
  }

  private takeoverDirectStageReadModels(
    stages: Prisma.PaymentTermsStageCreateManyInput[]
  ): HistoricalTakeoverDirectPaymentStageReadModel[] {
    return stages.flatMap((stage) => {
      if (
        !stage.id ||
        stage.stageType === "advance" ||
        stage.basis !== "contract_amount" ||
        stage.triggerAnchor !== "contract_effective"
      ) {
        return [];
      }
      return [
        {
          id: stage.id,
          name: stage.name,
          ratioBps: stage.ratioBps ?? null,
          fixedAmountCents: stage.fixedAmountCents?.toString() ?? null,
          dueDays: stage.dueDays,
          requiresInvoice: stage.requiresInvoice ?? false,
          allowsEarlyPayment: stage.allowsEarlyPayment ?? false,
          allowsInstallments: stage.allowsInstallments ?? true
        }
      ];
    });
  }

  private async createHistoricalInitialSettlement(
    tx: Prisma.TransactionClient,
    takeover: ContractTakeoverRecord
  ) {
    const amountCents = dbMoneyToBigInt(takeover.historicalSettledCents, "历史累计结算");
    if (amountCents <= 0n) {
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
        paidAmountCents: dbMoneyToBigInt(takeover.historicalPaidCents, "历史累计已付"),
        sourceType: "historical_takeover",
        sourceTakeoverId: takeover.id
      }
    });
  }

  private async assertTakeoverPaymentStages(
    tx: Prisma.TransactionClient,
    takeover: ContractTakeoverRecord
  ) {
    const [contract, stages] = await Promise.all([
      tx.contract.findUnique({
        where: { id: takeover.contractId },
        select: { contractTypeKey: true }
      }),
      tx.paymentTermsStage.findMany({
        where: { paymentTermsVersionId: takeover.paymentTermsVersionId },
        select: {
          id: true,
          name: true,
          stageType: true,
          basis: true,
          ratioBps: true,
          fixedAmountCents: true,
          triggerAnchor: true,
          dueDays: true,
          requiresInvoice: true,
          allowsEarlyPayment: true,
          allowsInstallments: true
        }
      })
    ]);
    const contractTypeKey = contract?.contractTypeKey?.trim() ?? "";
    if (contractTypeKey === "generic_contract") {
      const validDirectStages = stages.filter((stage) => {
        const hasRatio = stage.ratioBps !== null && stage.ratioBps > 0;
        const hasFixedAmount = stage.fixedAmountCents !== null && stage.fixedAmountCents > 0n;
        return (
          stage.name.trim().length > 0 &&
          stage.stageType !== "advance" &&
          stage.basis === "contract_amount" &&
          stage.triggerAnchor === "contract_effective" &&
          hasRatio !== hasFixedAmount &&
          Number.isInteger(stage.dueDays) &&
          stage.dueDays >= 0
        );
      });
      if (!stages.length || validDirectStages.length !== stages.length) {
        throw new BadRequestException(
          "通用合同的直接付款阶段未完整录入，请按原合同条款补齐后再确认接管"
        );
      }
      return;
    }
    if (!SETTLEMENT_CONTRACT_TYPE_KEYS.has(contractTypeKey)) {
      throw new BadRequestException("请先明确历史合同类型，再确认接管");
    }
    const hasValidSettlementStage = stages.some(
      (stage) =>
        stage.basis === "current_settlement" &&
        stage.triggerAnchor === "settlement_effective" &&
        stage.ratioBps !== null &&
        stage.ratioBps > 0
    );
    if (!hasValidSettlementStage) {
      throw new BadRequestException("该合同类型缺少有效的结算付款阶段，暂不能确认接管");
    }
  }
}

function normalizeHistoricalPricingItems(
  items: CreateContractTakeoverDto["pricingItems"],
  taxMode: "single_rate" | "multiple_rate",
  defaultTaxRatePercent: string | null
): HistoricalPricingItem[] {
  const normalized: HistoricalPricingItem[] = [];
  const rowKeys = new Set<string>();
  const billNames = new Map<string, string>();
  for (const [index, item] of (items ?? []).entries()) {
    const rowNo = index + 1;
    const billKey = requiredPricingText(item.billKey, `第 ${rowNo} 条清单标识`);
    const billName = requiredPricingText(item.billName, `第 ${rowNo} 条清单名称`);
    const rowKey = requiredPricingText(item.rowKey, `第 ${rowNo} 条项目标识`);
    const uniqueRowKey = `${billKey}\u0000${rowKey}`;
    if (rowKeys.has(uniqueRowKey)) {
      throw new BadRequestException(`清单“${billName}”中的项目标识“${rowKey}”重复`);
    }
    rowKeys.add(uniqueRowKey);
    const existingBillName = billNames.get(billKey);
    if (existingBillName && existingBillName !== billName) {
      throw new BadRequestException(`清单标识“${billKey}”不能对应多个清单名称`);
    }
    billNames.set(billKey, billName);

    const quantity = normalizeHistoricalDecimal(
      item.estimatedQuantity,
      `第 ${rowNo} 条预计数量`,
      { required: false, positive: true }
    );
    const unitPrice = normalizeHistoricalDecimal(
      item.taxInclusiveUnitPrice,
      `第 ${rowNo} 条含税单价`,
      { required: false, positive: false }
    );
    const overrideRate = item.taxRatePercentOverride?.trim()
      ? normalizeTakeoverTaxRate(
          item.taxRatePercentOverride,
          `第 ${rowNo} 条例外税率`
        )
      : null;
    if (taxMode === "single_rate" && overrideRate) {
      if (!defaultTaxRatePercent || !new Prisma.Decimal(overrideRate).eq(defaultTaxRatePercent)) {
        throw new BadRequestException(
          `第 ${rowNo} 条为单一税率合同，例外税率必须与合同默认税率一致`
        );
      }
    }
    const taxRatePercent = overrideRate ?? defaultTaxRatePercent;
    const amounts =
      quantity !== null && unitPrice !== null && taxRatePercent !== null
        ? calculateBillRow({
            quantity,
            unitPrice,
            taxRatePercent,
            pricingMode: "tax_inclusive"
          })
        : {
            taxInclusiveAmountCents: null,
            taxExclusiveAmountCents: null,
            taxAmountCents: null
          };
    normalized.push({
      billKey,
      billName,
      rowKey,
      itemCode: item.itemCode?.trim() || null,
      itemName: requiredPricingText(item.itemName, `第 ${rowNo} 条项目名称`),
      specification: item.specification?.trim() || null,
      unit: requiredPricingText(item.unit, `第 ${rowNo} 条计量单位`),
      quantity,
      unitPrice,
      taxRatePercent,
      taxRateSource: overrideRate ? "row_override" : "version_default",
      isProvisional: item.isProvisional ?? false,
      settlementBasis: item.settlementBasis?.trim() || null,
      ...amounts
    });
  }
  return normalized;
}

function normalizeTakeoverTaxRate(value: string, label: string): string {
  try {
    return normalizeTaxRatePercent(value);
  } catch {
    throw new BadRequestException(
      `${label}必须是大于 0 且不超过 100 的数字，最多保留 2 位小数`
    );
  }
}

function normalizeHistoricalDecimal(
  value: string | undefined,
  label: string,
  options: { required: boolean; positive: boolean }
): string | null {
  const text = value?.trim() ?? "";
  if (!text) {
    if (options.required) throw new BadRequestException(`${label}不能为空`);
    return null;
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(text)) {
    throw new BadRequestException(`${label}必须是非负数字且最多保留 2 位小数`);
  }
  const decimal = new Prisma.Decimal(text);
  if (options.positive && decimal.lte(0)) {
    throw new BadRequestException(`${label}必须大于 0`);
  }
  return text;
}

function requiredPricingText(value: string, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function optionalInvoiceType(value: unknown): CreateContractTakeoverDto["invoiceType"] {
  const text = stringValue(value);
  return text === "vat_general" || text === "vat_special" ? text : undefined;
}

function optionalTaxMode(value: unknown): CreateContractTakeoverDto["taxMode"] {
  const text = stringValue(value);
  return text === "single_rate" || text === "multiple_rate" ? text : undefined;
}

function optionalTaxFactSource(value: unknown): CreateContractTakeoverDto["taxFactSource"] {
  const text = stringValue(value);
  return [
    "contract_document",
    "supplement_evidence",
    "business_finance_confirmation"
  ].includes(text)
    ? text as NonNullable<CreateContractTakeoverDto["taxFactSource"]>
    : undefined;
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

function moneyString(value: bigint): string {
  return dbMoneyToBigInt(value, "历史接管金额").toString();
}

function correctionTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    amount: "金额更正",
    payment_terms: "付款条款更正",
    evidence: "资料更正",
    company_entity: "我方签约主体更正",
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
  if ("companyEntityId" in snapshot || "companyEntityName" in snapshot) {
    return `改前主体：${stringValue(snapshot.companyEntityName) || "—"}`;
  }
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
  if ("companyEntityId" in snapshot || "companyEntityName" in snapshot) {
    return `更正为：${stringValue(snapshot.companyEntityName) || "主体名称未读取"}`;
  }
  return stringValue(snapshot.summary) || "更正后的事实说明未读取";
}

function correctionStatusLabel(value: string): string {
  if (value === "submitted") return "待合同部主管确认";
  if (value === "confirmed") return "已确认";
  if (value === "rejected") return "已驳回";
  return "状态未读取";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isCompanyEntityCorrectionAttachmentConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  if (code !== "P2004" && code !== "P2010") return false;
  try {
    const detail = JSON.stringify(error);
    return (
      detail.includes("23514") ||
      detail.includes("该文件已用于其他业务，请重新上传专用的更正依据附件")
    );
  } catch {
    return false;
  }
}

function formatCents(value: unknown): string {
  try {
    if (typeof value === "bigint") {
      return `¥${formatMoneyCentsAsYuan(dbMoneyToBigInt(value, "历史接管金额"))}`;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value)) {
      return `¥${formatMoneyCentsAsYuan(parseMoneyCents(value, "历史接管金额"))}`;
    }
  } catch {
    return "金额未读取";
  }
  return "金额未读取";
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
  if (requiresHistoricalPaymentVoucher(takeover)) {
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

function requiresHistoricalPaymentVoucher(
  takeover: Pick<
    ContractTakeoverRecord,
    | "historicalApprovalPendingPaymentCents"
    | "historicalApprovedPendingPaymentCents"
    | "historicalPaidCents"
    | "historicalProxyPaidCents"
    | "historicalAdvancePaidCents"
    | "historicalRetentionWithheldCents"
    | "otherConfirmedOccupancyCents"
  >
) {
  return [
    takeover.historicalApprovalPendingPaymentCents,
    takeover.historicalApprovedPendingPaymentCents,
    takeover.historicalPaidCents,
    takeover.historicalProxyPaidCents,
    takeover.historicalAdvancePaidCents,
    takeover.historicalRetentionWithheldCents,
    takeover.otherConfirmedOccupancyCents
  ].some(positiveCents);
}

function positiveCents(value: bigint): boolean {
  return dbMoneyToBigInt(value, "历史接管金额") > 0n;
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
  historicalApprovalPendingPaymentCents: bigint;
  historicalApprovedPendingPaymentCents: bigint;
  historicalProxyPaidCents: bigint;
  historicalRetentionWithheldCents: bigint;
  otherConfirmedOccupancyCents: bigint;
}): ContractTakeoverLevel {
  const evidenceText = `${input.balanceSourceSummary ?? ""} ${input.evidenceSummary ?? ""}`;
  if (input.lifecycleStatus === "disputed" || /争议|缺|待补|受限|无法|不一致/.test(evidenceText)) {
    return "C";
  }

  if (
    input.historicalApprovalPendingPaymentCents > 0n ||
    input.historicalApprovedPendingPaymentCents > 0n ||
    input.historicalProxyPaidCents > 0n ||
    input.historicalRetentionWithheldCents > 0n ||
    input.otherConfirmedOccupancyCents > 0n
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

function moneyTextValue(value: unknown): string | null {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) ? value : null;
}

function safePrecheckMoneyValue(value: unknown, fieldName: string): bigint | null {
  const text = moneyTextValue(value);
  if (text === null) return null;
  try {
    return parseMoneyCents(text, fieldName);
  } catch {
    return null;
  }
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
): bigint {
  if (isBlankInput(row[field])) {
    return 0n;
  }
  return safePrecheckMoneyValue(row[field], MONEY_FIELD_LABELS[field]) ?? 0n;
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

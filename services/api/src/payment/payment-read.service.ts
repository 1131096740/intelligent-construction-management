import { isConfirmedTextAgreementContract, PAYMENT_TEXT_AGREEMENT_BASIS, readTextAgreementContractLimit, readTextPaymentAgreement } from "./payment-text-agreement";
import { sensitiveBusinessReadAllowed, hasSensitiveLedgerReadRole } from "../auth/sensitive-business-read";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { exportBusinessLedger } from "../core-flow/business-ledger-export";
import {
  LEDGER_DATE_FORMAT,
  LEDGER_MONEY_FORMAT,
  type LedgerExcelColumn
} from "../core-flow/ledger-excel";
import {
  matchesLedgerExportQuery,
  normalizeLedgerExportQuery,
  sortLedgerRows,
  type NormalizedLedgerExportQuery
} from "../core-flow/ledger-export-query";
import { contractProxyPaidForContract } from "../contract-ledger/contract-proxy-capacity";
import { chinaDateOnly, downstreamContractRelationship, CONTRACT_RELATIONSHIP_LABELS } from "@jiangkong/shared-domain";
import { contractClassifications } from "../contract-ledger/contract-classification-read";
import { registeredPaymentInstalled } from "../database/registered-payment-catalog";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PaymentRequestService } from "./payment-request.service";
import { hasPaymentRevisionBasis, paymentRevisionAction } from "./payment-revision-basis";
import { hasOrdinaryPaymentParallelMarker, isOrdinaryPaymentParallelRound, loadOrdinaryPaymentDelegationPrincipals, resolveOrdinaryPaymentDuty } from "./ordinary-payment-parallel";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { assertOrdinaryApplicantCannotReview } from "../approval/approval-self-review";
import { currentRegisteredPaymentApproval } from "./registered-payment-approval";
import { currentRegisteredPaymentDomain } from "./registered-payment-domain";
import { assertRegisteredPaymentActor } from "./registered-payment-funding";
import { paymentExecutionVoucherFileId } from "./payment-execution-voucher";
import type {
  BusinessEntryFrozenSnapshot,
  BusinessEntrySceneDefinition,
  ContractPaymentApplicationPreviewReadModel,
  CoreFlowTone,
  DetailActionReadModel,
  PaymentDetailReadModel,
  RoleKey
} from "@jiangkong/shared-domain";
import {
  canPerform,
  directPaymentAmountNature,
  isContractSettlementMode,
  resolveEffectiveRoleKeys
} from "@jiangkong/shared-domain";
import {
  approvalReviewAccessOnFrozenNode,
  type ApprovalReviewAccess
} from "../approval/approval-node-access";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  detailAction,
  disabledActionReasons,
  primaryActionKey
} from "../core-flow/detail-actions";
import { approvalTimelineForBusiness } from "../core-flow/approval-timeline-read";
import { PrismaService } from "../database/prisma.service";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsPlainYuan,
  formatMoneyCentsAsYuan,
  moneyCentsToApi,
  sumDbMoneyToBigInt
} from "../money/decimal-money";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  type ContractTakeoverBalanceRow,
  toHistoricalContractPaymentBalance
} from "./contract-takeover-balance";
import {
  buildContractPaymentApplicationPreview,
  CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES,
  SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
  sumMoneyCents
} from "./settlement-payment-capacity";
import { loadSettlementPaymentConfirmationFacts } from "./settlement-confirmation-facts";
import { loadSignedSettlementPaymentBasis } from "./signed-settlement-payment-capacity";
import { PAYMENT_FINANCE_ENTRY_DEFINITION } from "./payment-business-entry-definition";

type RegisteredExecutionCapability = {
  supportedDomain: boolean;
  allowedActor: boolean;
  workflowReady: boolean;
  canSupplementVoucher: boolean;
  blockedReason: string | null;
};

type PaymentDetailLifecycleProjection = {
  registeredExecutionCapability?: RegisteredExecutionCapability;
  lifecycleKind: "approval_draft" | "formal_record";
  ledgerView: "formal_ledger" | "returned_for_revision" | "ended";
  nextStep: string;
  currentOwner: string;
  returnReason: string;
  lifecycleUpdatedAt: string | null;
  blockedReasons: string[];
  reviewApprovalContext: PaymentApprovalReviewContext | null;
  executionContext: PaymentExecutionContext | null;
  withdrawApprovalContext?: { expectedApprovalInstanceId: string };
  remainderWithdrawalContext?: { expectedUpdatedAt: string; remainingAmountCents: string };
  delegationApprovalContext?: PaymentDelegationApprovalContext;
  revisionSubmissionContext?: {
    expectedUpdatedAt: string;
    requestedAmountCents: string;
    paymentMatter: string | null;
    amountCalculationExplanation: string | null;
  };
};

type PaymentLedgerView = "formal_ledger" | "my_drafts" | "returned_for_revision" | "ended";

type PaymentApprovalReviewContext = {
  expectedPaymentUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
  canReturnForRevision?: true;
  executionMode?: "parallel";
};

type PaymentExecutionContext = {
  expectedPaymentUpdatedAt: string;
};

type PaymentDelegationApprovalContext = {
  expectedApprovalInstanceId: string;
  expectedApprovalUpdatedAt: string;
  duties: Array<{ index: number; name: string }>;
};

type CurrentPaymentApprovalReview = {
  delegation?: PaymentDelegationApprovalContext;
  access: ApprovalReviewAccess;
  approval: {
    id: string;
    currentNodeIndex: number;
    updatedAt: Date;
    executionMode?: "parallel";
  } | null;
};

interface PaymentLedgerQuery {
  view?: PaymentLedgerView;
  page?: string | number;
  pageSize?: string | number;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  keyword?: string;
  sort?: string;
  columns?: string | string[];
}

function emptyApprovalReviewAccess(): ApprovalReviewAccess {
  return { canAct: false, canReview: false, requiresSelfReviewConfirmation: false };
}

function emptyCurrentPaymentApprovalReview(): CurrentPaymentApprovalReview {
  return { access: emptyApprovalReviewAccess(), approval: null };
}

function directPaymentSummary(
  amountLimitType: string | null | undefined,
  payments: Array<{
    sourceType: string;
    status: string;
    requestedAmountCents: bigint;
    approvedAmountCents: bigint | null;
    paidAmountCents: bigint;
  }>
) {
  const directPayments = payments.filter(
    (payment) => payment.sourceType === "contract_due"
  );
  const cumulativeRequestedCents = sumMoneyCents(
    directPayments.map((payment) => payment.requestedAmountCents)
  );
  const cumulativeApprovedCents = sumMoneyCents(
    directPayments.map((payment) =>
      ["approved_pending_payment", "partially_paid", "paid"].includes(
        payment.status
      )
        ? (payment.approvedAmountCents ?? payment.requestedAmountCents)
        : 0n
    )
  );
  const cumulativePaidCents = sumMoneyCents(
    directPayments.map((payment) => payment.paidAmountCents)
  );
  const amountNature = directPaymentAmountNature({ amountLimitType });
  return {
    amountNature,
    unlimitedTotal: amountNature === "unlimited_total",
    cumulativeRequestedCents: moneyCentsToApi(cumulativeRequestedCents),
    cumulativeApprovedCents: moneyCentsToApi(cumulativeApprovedCents),
    cumulativePaidCents: moneyCentsToApi(cumulativePaidCents)
  };
}

type PaymentDetailActivity =
  | { kind: "execution"; id: string; amountCents: bigint; paidAt: Date; createdAt: Date;
      executedByUserId: string; voucherFileId: string | null }
  | { kind: "finance"; id: string; amountCents: bigint };

@Injectable()
export class PaymentReadService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly projectVisibility?: ProjectVisibilityService,
    @Optional()
    private readonly payments?: PaymentRequestService,
    @Optional()
    private readonly audit?: AuditService
  ) {}

  private async latestPaymentApproval(paymentId: string) {
    const client = (this.prisma as unknown as {
      approvalInstance?: {
        findFirst(args: {
          where: { businessType: string; businessId: string; flowType: string };
          orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>;
        }): Promise<{
          id: string;
          status: string;
          applicantUserId: string;
          frozenNodes?: unknown;
        } | null>;
      };
    }).approvalInstance;
    if (!client) return null;
    return client.findFirst({
      where: {
        businessType: "payment_request",
        businessId: paymentId,
        flowType: "payment.approve"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  }

  private async paymentEvidenceFiles(
    payment: { id: string; projectId: string; contractId: string },
    executions: Array<{
      id: string;
      voucherFileId?: string | null;
      executedByUserId?: string | null;
      createdAt?: Date;
    }>
  ): Promise<PaymentDetailReadModel["evidenceFiles"]> {
    const client = this.prisma as unknown as {
      fileObject?: {
        findMany(args: { where: { id: { in: string[] } }; select: Record<string, boolean> }): Promise<
          Array<{
            id: string;
            originalName: string;
            mimeType: string;
            sizeBytes: number;
            uploadedByUserId: string;
            createdAt: Date;
          }>
        >;
      };
      user?: {
        findMany(args: { where: { id: { in: string[] } } }): Promise<
          Array<{ id: string; name: string }>
        >;
      };
    };

    if (!client.fileObject) {
      return [];
    }

    const pdfDocuments = await this.prisma.$queryRaw<Array<{
      id: string; fileId: string; templateKey: string; createdAt: Date;
    }>>`
      SELECT * FROM public.jg_read_payment_detail_pdf_v1(${payment.id}::text, ${payment.projectId}::text, ${payment.contractId}::text)
    `;
    const executionVoucherViews = await Promise.all(
      executions.map(async (execution) => ({
        ...execution,
        voucherFileId: await paymentExecutionVoucherFileId(this.prisma, {
          id: execution.id,
          voucherFileId: execution.voucherFileId ?? null
        })
      }))
    );
    const voucherRows = executionVoucherViews.filter((execution) => execution.voucherFileId);
    const fileIds = Array.from(
      new Set([
        ...voucherRows.map((execution) => execution.voucherFileId as string),
        ...pdfDocuments.map((document) => document.fileId)
      ])
    );
    if (!fileIds.length) {
      return [];
    }

    const files = await client.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, uploadedByUserId: true, createdAt: true }
    });
    const fileById = new Map(files.map((file) => [file.id, file]));
    const userIds = Array.from(
      new Set(files.map((file) => file.uploadedByUserId))
    );
    const users = client.user && userIds.length
      ? await client.user.findMany({ where: { id: { in: userIds } } })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));

    return [
      ...voucherRows.flatMap((execution) => {
        const file = fileById.get(execution.voucherFileId as string);
        if (!file) {
          return [];
        }

        return [
          {
            recordId: execution.id,
            fileId: file.id,
            fileName: file.originalName,
            purpose: "付款凭证",
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            status: "uploaded",
            statusLabel: "已上传",
            uploadedByName:
              userById.get(file.uploadedByUserId)?.name ?? "上传人未读取",
            uploadedAt: file.createdAt.toISOString(),
            confirmedByName: null,
            confirmedAt: null,
            canDownload: true,
            disabledReason: null
          }
        ];
      }),
      ...pdfDocuments.flatMap((document) => {
        const file = fileById.get(document.fileId);
        if (!file) {
          return [];
        }

        return [
          {
            recordId: document.id,
            fileId: file.id,
            fileName: file.originalName,
            purpose: this.paymentPdfPurposeLabel(document.templateKey),
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            status: "archived",
            statusLabel: "已归档",
            uploadedByName: userById.get(file.uploadedByUserId)?.name ?? "上传人未读取",
            uploadedAt: document.createdAt.toISOString(),
            confirmedByName: null,
            confirmedAt: null,
            canDownload: true,
            disabledReason: null
          }
        ];
      })
    ];
  }

  private executionCoverages(
    paymentCode: string,
    executions: Array<{
      id: string;
      amountCents: bigint;
      paidAt?: Date | null;
      createdAt?: Date;
    }>,
    financeRecords: Array<{ amountCents: bigint }>,
    evidenceFiles: PaymentDetailReadModel["evidenceFiles"]
  ): PaymentDetailReadModel["executionCoverages"] {
    let remainingFinanceCents = sumDbMoneyToBigInt(
      financeRecords.map((record) => record.amountCents),
      "财务入账金额"
    );
    const voucherNameByExecutionId = new Map(
      evidenceFiles
        .filter((file) => file.purpose === "付款凭证")
        .map((file) => [file.recordId, file.fileName])
    );

    return [...executions]
      .sort((left, right) => this.executionTime(left) - this.executionTime(right))
      .map((execution, index) => {
        const financeRecordedAmountCents =
          execution.amountCents < remainingFinanceCents
            ? execution.amountCents
            : remainingFinanceCents;
        remainingFinanceCents -= financeRecordedAmountCents;
        const unrecordedAmountCents = execution.amountCents - financeRecordedAmountCents;
        return {
          id: execution.id,
          executionCode: `${paymentCode} · 第${index + 1}笔`,
          paidAt: (execution.paidAt ?? execution.createdAt)?.toISOString() ?? "-",
          paidAmount: this.formatMoney(execution.amountCents),
          voucherName: voucherNameByExecutionId.get(execution.id) ?? "未上传付款凭证",
          financeRecordedAmount: this.formatMoney(financeRecordedAmountCents),
          unrecordedAmount: this.formatMoney(unrecordedAmountCents),
          coverageStatus:
            unrecordedAmountCents === 0n
              ? "已全部入账"
              : financeRecordedAmountCents > 0n
                ? "部分入账"
                : "待入账"
        };
      })
      .reverse();
  }

  private executionTime(execution: { paidAt?: Date | null; createdAt?: Date }) {
    return (execution.paidAt ?? execution.createdAt ?? new Date(0)).getTime();
  }

  private async confirmedHistoricalBalanceForContract(contractId: string) {
    const takeoverClient = (this.prisma as unknown as {
      contractTakeover?: {
        findFirst(args: {
          where: {
            contractId: string;
            takeoverStatus: string;
            historicalBalanceConfirmedAt: { not: null };
          };
          select: typeof CONTRACT_TAKEOVER_BALANCE_SELECT;
        }): Promise<ContractTakeoverBalanceRow | null>;
      };
    }).contractTakeover;

    if (!takeoverClient) {
      return undefined;
    }

    const takeover = await takeoverClient.findFirst({
      where: {
        contractId,
        takeoverStatus: "confirmed",
        historicalBalanceConfirmedAt: { not: null }
      },
      select: CONTRACT_TAKEOVER_BALANCE_SELECT
    });

    return toHistoricalContractPaymentBalance(takeover);
  }

  async listRecent(
    rawLimit?: string | number,
    visibleProjectIds?: string[],
    options?: { all?: boolean; actorUserId?: string }
  ) {
    const take = this.limit(rawLimit);
    const allPayments = await this.prisma.paymentRequest.findMany({
      ...(visibleProjectIds ? { where: { projectId: { in: visibleProjectIds } } } : {}),
      ...(options?.all ? {} : { take }),
      orderBy: { updatedAt: "desc" }
    });
    const payments = options?.actorUserId ? (await Promise.all(allPayments.map(async row =>
      await sensitiveBusinessReadAllowed(this.prisma, "payment_request", row.id, options.actorUserId!, await this.actorRoleKeys(options.actorUserId, row.projectId)) ? row : null
    ))).filter((row): row is NonNullable<typeof row> => row !== null) : allPayments;
    const historicalClient = this.prisma as unknown as {
      contractTakeover?: {
        findMany(args: unknown): Promise<Array<{
          id: string;
          projectId: string;
          contractId: string;
          historicalInitialSettlementId: string | null;
          activatedAt: Date | null;
        }>>;
      };
      contractTakeoverHistoricalPayment?: {
        findMany(args: unknown): Promise<Array<{
          id: string;
          takeoverId: string;
          rowKey: string;
          sequenceNo: number;
          amountCents: bigint;
          paidAt: Date;
          status: string;
          activatedAt: Date | null;
          updatedAt: Date;
        }>>;
      };
      contractTakeoverHistoricalPaymentVoucher?: {
        findMany(args: unknown): Promise<Array<{
          historicalPaymentId: string;
          fileId: string;
          displayOrder: number;
        }>>;
      };
    };
    const canReadHistoricalTakeoverPayments =
      Boolean(historicalClient.contractTakeover?.findMany) &&
      Boolean(
        historicalClient.contractTakeoverHistoricalPayment?.findMany
      ) &&
      Boolean(
        historicalClient.contractTakeoverHistoricalPaymentVoucher?.findMany
      );
    const allHistoricalTakeovers = canReadHistoricalTakeoverPayments
      ? await historicalClient.contractTakeover!.findMany({
          where: {
            ...(visibleProjectIds
              ? { projectId: { in: visibleProjectIds } }
              : {}),
            activatedAt: { not: null }
          },
          select: {
            id: true,
            projectId: true,
            contractId: true,
            historicalInitialSettlementId: true,
            activatedAt: true
          },
          orderBy: { activatedAt: "desc" }
        })
      : [];
    const historicalTakeovers = options?.actorUserId ? (await Promise.all(allHistoricalTakeovers.map(async row =>
      hasSensitiveLedgerReadRole("payment_request", await this.actorRoleKeys(options.actorUserId, row.projectId)) ? row : null
    ))).filter((row): row is NonNullable<typeof row> => row !== null) : allHistoricalTakeovers;
    const takeoverIds = historicalTakeovers.map(
      (takeover) => takeover.id
    );
    const historicalPayments = takeoverIds.length
      ? await historicalClient.contractTakeoverHistoricalPayment!.findMany({
          where: {
            takeoverId: { in: takeoverIds },
            status: "activated"
          },
          orderBy: [
            { activatedAt: "desc" },
            { takeoverId: "asc" },
            { sequenceNo: "asc" }
          ]
        })
      : [];
    const historicalPaymentIds = historicalPayments.map(
      (payment) => payment.id
    );
    const historicalVouchers = historicalPaymentIds.length
      ? await historicalClient.contractTakeoverHistoricalPaymentVoucher!.findMany({
          where: {
            historicalPaymentId: { in: historicalPaymentIds }
          },
          select: {
            historicalPaymentId: true,
            fileId: true,
            displayOrder: true
          },
          orderBy: [
            { historicalPaymentId: "asc" },
            { displayOrder: "asc" }
          ]
        })
      : [];
    const paymentIds = payments.map((payment) => payment.id);
    const approvalClient = (this.prisma as unknown as {
      approvalInstance?: {
        findMany(args: {
          where: { businessType: string; businessId: { in: string[] }; flowType: string };
          select: { id: true; businessId: true; status: true; createdAt: true; applicantUserId: true; frozenNodes: true };
          orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>;
        }): Promise<Array<{ id: string; businessId: string; status: string; createdAt: Date; applicantUserId: string; frozenNodes?: unknown }>>;
      };
      approvalActionLog?: {
        findMany(args: {
          where: { approvalInstanceId: { in: string[] }; action: { in: string[] } };
          select: { approvalInstanceId: true; action: true; actorUserId: true };
        }): Promise<Array<{ approvalInstanceId: string; action: string; actorUserId: string }>>;
      };
    });
    const settlementIds = [
      ...new Set(
        [
          ...payments.map((payment) => payment.settlementId),
          ...historicalTakeovers.map(
            (takeover) => takeover.historicalInitialSettlementId
          )
        ]
          .filter((settlementId): settlementId is string => typeof settlementId === "string")
      )
    ];
    const projectIds = [
      ...new Set([
        ...payments.map((payment) => payment.projectId),
        ...historicalTakeovers.map((takeover) => takeover.projectId)
      ])
    ];
    const contractIds = [
      ...new Set([
        ...payments.map((payment) => payment.contractId),
        ...historicalTakeovers.map((takeover) => takeover.contractId)
      ])
    ];
    const [settlements, projects, contracts, executions, refunds, corrections, approvalInstances] = await Promise.all([
      settlementIds.length
        ? this.prisma.settlement.findMany({ where: { id: { in: settlementIds } } })
        : Promise.resolve([]),
      projectIds.length
        ? this.prisma.project.findMany({ where: { id: { in: projectIds } } })
        : Promise.resolve([]),
      contractIds.length
        ? this.prisma.contract.findMany({
            where: { id: { in: contractIds } },
            select: { id: true, code: true, name: true, companyEntityName: true, counterparty: true }
          })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.paymentExecution.findMany({ where: { paymentRequestId: { in: paymentIds } } })
        : Promise.resolve([]),
      this.readPaymentRefunds(paymentIds),
      this.readPaymentCorrectionDeltas(paymentIds),
      paymentIds.length && approvalClient.approvalInstance
        ? approvalClient.approvalInstance.findMany({
            where: {
              businessType: "payment_request",
              businessId: { in: paymentIds },
              flowType: "payment.approve"
            },
            select: { id: true, businessId: true, status: true, createdAt: true, applicantUserId: true, frozenNodes: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }]
          })
        : Promise.resolve([])
    ]);
    const latestApprovalByPaymentId = new Map<string, (typeof approvalInstances)[number]>();
    for (const instance of approvalInstances) {
      if (!latestApprovalByPaymentId.has(instance.businessId)) {
        latestApprovalByPaymentId.set(instance.businessId, instance);
      }
    }
    const revisions = new Map([...latestApprovalByPaymentId.values()].flatMap(round => {
      const action = paymentRevisionAction(round);
      return action ? [[round.id, { action, applicantUserId: round.applicantUserId }] as const] : [];
    }));
    const revisionActions = revisions.size && approvalClient.approvalActionLog
      ? await approvalClient.approvalActionLog.findMany({
          where: {
            approvalInstanceId: { in: [...revisions.keys()] },
            action: { in: ["return_to_applicant", "withdraw"] }
          },
          select: { approvalInstanceId: true, action: true, actorUserId: true }
        })
      : [];
    const editableRoundIds = new Set(revisionActions.flatMap(log => {
      const revision = revisions.get(log.approvalInstanceId);
      return revision?.action === log.action && (log.action !== "withdraw" || revision.applicantUserId === log.actorUserId)
        ? [log.approvalInstanceId] : [];
    }));
    const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const paidByPaymentId = new Map<string, bigint>();
    for (const execution of executions) {
      paidByPaymentId.set(
        execution.paymentRequestId,
        (paidByPaymentId.get(execution.paymentRequestId) ?? 0n) + execution.amountCents
      );
    }
    const refundedByPaymentId = new Map<string, bigint>();
    for (const refund of refunds) {
      refundedByPaymentId.set(
        refund.paymentRequestId,
        (refundedByPaymentId.get(refund.paymentRequestId) ?? 0n) + refund.amountCents
      );
    }
    const correctionDeltaByPaymentId = new Map<string, bigint>();
    for (const correction of corrections) {
      correctionDeltaByPaymentId.set(
        correction.paymentRequestId,
        (correctionDeltaByPaymentId.get(correction.paymentRequestId) ?? 0n) + correction.amountDeltaCents
      );
    }
    const takeoverById = new Map(
      historicalTakeovers.map((takeover) => [takeover.id, takeover])
    );
    const voucherFileIdsByPaymentId = new Map<string, string[]>();
    for (const voucher of historicalVouchers) {
      const fileIds =
        voucherFileIdsByPaymentId.get(voucher.historicalPaymentId) ??
        [];
      fileIds.push(voucher.fileId);
      voucherFileIdsByPaymentId.set(
        voucher.historicalPaymentId,
        fileIds
      );
    }

    const classificationByVersion = await contractClassifications(this.prisma, payments.map((p) => p.contractVersionId));
    const signedContractIds = [
      ...new Set(
        payments
          .filter((payment) => payment.signedSettlementId)
          .map((payment) => payment.contractId)
      )
    ];
    const signedBasisByContract = new Map<string, Awaited<ReturnType<typeof loadSignedSettlementPaymentBasis>>>();
    for (const contractId of signedContractIds) {
      try {
        signedBasisByContract.set(
          contractId,
          await loadSignedSettlementPaymentBasis(
            this.prisma as unknown as Prisma.TransactionClient,
            contractId
          )
        );
      } catch (error) {
        // 没有最近确认的已签结算时列表照常展示原申请；其他读取故障不能被静默吞掉。
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    const requestRows = payments.map((payment) => {
      const latestApproval = latestApprovalByPaymentId.get(payment.id);
      const returnedForRevision = payment.status === "draft" &&
        Boolean(latestApproval && editableRoundIds.has(latestApproval.id));
      const ended = ["abandoned", "withdrawn", "approval_rejected", "rejected", "voided"].includes(
        payment.status
      );
      const ledgerView = ended
        ? "ended"
        : returnedForRevision
          ? "returned_for_revision"
          : "formal_ledger";
      const grossPaidAmountCents = paidByPaymentId.get(payment.id) ?? payment.paidAmountCents;
      const refundedAmountCents = refundedByPaymentId.get(payment.id) ?? 0n;
      const correctionDeltaCents = correctionDeltaByPaymentId.get(payment.id) ?? 0n;
      const paidAmountCents = grossPaidAmountCents + correctionDeltaCents - refundedAmountCents;
      const payableAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      const withdrawnForRevision = returnedForRevision && latestApproval?.status === "withdrawn";
      const revisionStatus = withdrawnForRevision ? "withdrawn_for_revision" : "returned_for_revision";
      const approval = this.approvalStatusView(returnedForRevision ? revisionStatus : payment.status);
      const remainderWithdrawn = payment.remainingWithdrawnCents != null;
      const execution = remainderWithdrawn
        ? { label: "余款已撤回", tone: "default" as const, complete: true }
        : this.executionStatusView(payment.status, paidAmountCents, payableAmountCents);
      const nextAction = ended || remainderWithdrawn
        ? "已结束"
        : returnedForRevision
        ? "补充付款申请或放弃申请"
        : this.nextActionLabel(payment.status, execution.complete);
      const pendingOwner = ended || remainderWithdrawn
        ? "-"
        : returnedForRevision
        ? "申请人"
        : this.currentOwnerLabel(payment.status, execution.complete);
      const contract = contractById.get(payment.contractId);
      const signedBasis = payment.signedSettlementId
        ? signedBasisByContract.get(payment.contractId)
        : undefined;
      const suspensionApplies =
        Boolean(signedBasis?.suspended) && !remainderWithdrawn && payableAmountCents - paidAmountCents > 0n;

      return {
        id: payment.code,
        paymentNo: payment.code,
        contractRelationshipLabel: classificationByVersion.get(payment.contractVersionId) ?? "待确认分类",
        contractNo: contract
          ? [contract.code, contract.name].filter(Boolean).join(" · ")
          : "合同信息未读取",
        settlementNo: payment.settlementId
          ? (settlementById.get(payment.settlementId)?.code ?? payment.settlementId)
          : payment.paymentTermsStageId && payment.sourceType === "contract_due"
            ? "合同冻结阶段直接付款"
            : payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS
              ? "按合同约定直接付款" : this.paymentSourceLabel(payment.sourceType),
        project: projectById.get(payment.projectId)?.name ?? payment.projectId,
        projectId: payment.projectId,
        contractId: payment.contractId,
        signingParty: contract?.companyEntityName ?? "待确定",
        counterparty: contract?.counterparty ?? "待确定",
        requestedAmount: this.formatMoney(payment.requestedAmountCents),
        approvalStatus: approval.label,
        approvalTone: approval.tone,
        paymentStatus: execution.label,
        paymentTone: execution.tone,
        currentNode: nextAction,
        ownerDepartment: pendingOwner,
        pendingOwner,
        stalledFor: this.stalledFor(payment.updatedAt),
        returnReason: payment.status === "abandoned"
          ? (payment.abandonReason ?? "付款申请已放弃")
          : returnedForRevision
          ? (withdrawnForRevision ? "申请已撤回，可修改后重新提交" : "审批退回待修改，查看审批历史")
          : this.returnReason(payment.status),
        nextAction,
        lifecycleKind: returnedForRevision || payment.status === "abandoned"
          ? "approval_draft"
          : "formal_record",
        ledgerView,
        lifecycleUpdatedAt: payment.updatedAt.toISOString(),
        requestedAmountCents: moneyCentsToApi(payment.requestedAmountCents),
        paidAmountCents: moneyCentsToApi(paidAmountCents),
        grossPaidAmountCents: moneyCentsToApi(grossPaidAmountCents),
        refundedAmountCents: moneyCentsToApi(refundedAmountCents),
        correctionDeltaCents: moneyCentsToApi(correctionDeltaCents),
        ...(signedBasis
          ? {
              capacitySuspended: suspensionApplies,
              capacityStatusLabel: suspensionApplies
                ? "合同累计可付余额不足，已暂停"
                : "容量正常",
              capacityRemainingCents: moneyCentsToApi(signedBasis.remainingCents),
              unsettledAdvanceCents: moneyCentsToApi(signedBasis.unsettledAdvanceCents),
              overpayCents: moneyCentsToApi(signedBasis.overpayCents)
            }
          : {}),
        availableActions:
          returnedForRevision &&
          options?.actorUserId &&
          latestApproval?.applicantUserId === options.actorUserId
            ? ["abandon_application"]
            : [],
        blockedReasons:
          returnedForRevision &&
          options?.actorUserId &&
          latestApproval?.applicantUserId !== options.actorUserId
            ? ["只有原申请人可以结束退回待修改的付款申请"]
            : [],
        updatedAt: this.date(payment.updatedAt)
      };
    });
    const historicalRows = historicalPayments.map((payment) => {
      const takeover = takeoverById.get(payment.takeoverId);
      if (!takeover) {
        throw new Error(
          `历史实付 ${payment.id} 缺少已激活接管主记录`
        );
      }
      const contract = contractById.get(takeover.contractId);
      const activatedAt =
        payment.activatedAt ?? takeover.activatedAt ?? payment.updatedAt;
      return {
        id: payment.id,
        paymentNo: `历史实付-${payment.sequenceNo}`,
        contractNo: contract
          ? [contract.code, contract.name].filter(Boolean).join(" · ")
          : "合同信息未读取",
        settlementNo: takeover.historicalInitialSettlementId
          ? (settlementById.get(takeover.historicalInitialSettlementId)
              ?.code ?? takeover.historicalInitialSettlementId)
          : "合同期初直接实付",
        project:
          projectById.get(takeover.projectId)?.name ??
          takeover.projectId,
        projectId: takeover.projectId,
        contractId: takeover.contractId,
        signingParty: contract?.companyEntityName ?? "待确定",
        counterparty: contract?.counterparty ?? "待确定",
        requestedAmount: this.formatMoney(payment.amountCents),
        approvalStatus: "无需审批",
        approvalTone: "default" as CoreFlowTone,
        paymentStatus: "已付款",
        paymentTone: "success" as CoreFlowTone,
        currentNode: "历史实付已确认",
        ownerDepartment: "财务",
        pendingOwner: "-",
        stalledFor: "-",
        returnReason: "-",
        nextAction: "已发生实付，不重新审批",
        lifecycleKind: "formal_record" as const,
        ledgerView: "formal_ledger" as const,
        lifecycleUpdatedAt: activatedAt.toISOString(),
        requestedAmountCents: moneyCentsToApi(payment.amountCents),
        paidAmountCents: moneyCentsToApi(payment.amountCents),
        availableActions: [] as string[],
        blockedReasons: [] as string[],
        updatedAt: this.date(activatedAt),
        sourceType: "historical_takeover",
        sourceLabel: "历史接管",
        natureLabel: "已发生实付，不重新审批",
        voucherFileIds:
          voucherFileIdsByPaymentId.get(payment.id) ?? []
      };
    });
    const rows = [...requestRows, ...historicalRows];
    if (historicalRows.length > 0) {
      rows.sort(
        (left, right) =>
          Date.parse(right.lifecycleUpdatedAt) -
          Date.parse(left.lifecycleUpdatedAt)
      );
    }
    const visibleRows = options?.all ? rows : rows.slice(0, take);

    return {
      rows: visibleRows,
      summary: {
        total: visibleRows.length,
        pendingApproval: payments.filter((payment) => payment.status === "approval_pending").length,
        orSign: payments.filter((payment) => payment.status === "approval_pending").length,
        pendingPayment: payments.filter((payment) => payment.status === "approved_pending_payment").length,
        paid: visibleRows.filter((row) => row.paymentStatus === "已付款").length
      }
    };
  }

  async listLedger(
    query: PaymentLedgerQuery,
    visibleProjectIds: string[] | undefined,
    actorUserId: string
  ) {
    const view = this.paymentLedgerView(query.view);
    const page = this.positiveInteger(query.page, 1);
    const pageSize = Math.min(this.positiveInteger(query.pageSize, 20), 100);
    const normalized = normalizeLedgerExportQuery(query as Record<string, unknown>);
    const allRows = await this.readLedgerRows(visibleProjectIds, actorUserId, normalized);
    const rowsByView = this.rowsByPaymentView(allRows);
    const selectedRows = rowsByView[view];
    const offset = (page - 1) * pageSize;
    const formalRows = rowsByView.formal_ledger;

    return {
      rows: selectedRows.slice(offset, offset + pageSize),
      view,
      hasPersistentDraft: false,
      pagination: {
        page,
        pageSize,
        total: selectedRows.length,
        totalPages: selectedRows.length === 0 ? 0 : Math.ceil(selectedRows.length / pageSize)
      },
      viewCounts: {
        formal_ledger: rowsByView.formal_ledger.length,
        my_drafts: 0,
        returned_for_revision: rowsByView.returned_for_revision.length,
        ended: rowsByView.ended.length
      },
      statistics: {
        formalRequestedAmountCents: moneyCentsToApi(
          formalRows.reduce((sum, row) => sum + BigInt(row.requestedAmountCents), 0n)
        ),
        formalPaidAmountCents: moneyCentsToApi(
          formalRows.reduce((sum, row) => sum + BigInt(row.paidAmountCents), 0n)
        ),
        pendingApproval: formalRows.filter((row) => row.approvalStatus === "审批中").length,
        pendingPayment: formalRows.filter((row) => row.paymentStatus === "已批待付").length,
        paid: formalRows.filter((row) => row.paymentStatus === "已付款").length
      },
      filters: {
        projectId: normalized.projectId ?? null,
        dateFrom: normalized.dateFrom ?? null,
        dateTo: normalized.dateTo ?? null,
        status: normalized.status ?? null,
        keyword: normalized.keyword ?? null,
        sort: normalized.sortField
          ? `${normalized.sortField}:${normalized.sortDirection}`
          : null
      },
      columns: PAYMENT_LEDGER_COLUMNS.map((column) => ({
        key: String(column.key),
        header: column.header,
        required: Boolean(column.required)
      }))
    };
  }

  /**
   * 付款台账导出：与列表共用 `readLedgerRows`（含 `listRecent` 的逐行
   * `sensitiveBusinessReadAllowed` 判定），筛选、视图与列解析完全一致。
   * 导出不扩大读取范围；无权行不会出现在工作簿中。
   */
  async exportLedger(
    visibleProjectIds: string[] | undefined,
    actorUserId: string,
    rawQuery?: Record<string, unknown>
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const normalized = normalizeLedgerExportQuery(rawQuery);
    const allRows = await this.readLedgerRows(visibleProjectIds, actorUserId, normalized);
    const view = this.paymentLedgerView(rawQuery?.view as PaymentLedgerView | undefined);
    const rows = this.rowsByPaymentView(allRows)[view].map((row) => ({
      ...row,
      requestedAmountYuan: formatMoneyCentsAsPlainYuan(BigInt(row.requestedAmountCents)),
      paidAmountYuan: formatMoneyCentsAsPlainYuan(BigInt(row.paidAmountCents)),
      updatedAtIso: row.lifecycleUpdatedAt
    }));
    return exportBusinessLedger({
      prisma: this.prisma,
      audit: this.audit,
      actorUserId,
      action: "payment.ledger.export",
      businessType: "payment_ledger",
      scope: "all_filtered_visible_payment_records",
      sheetName: "付款台账",
      fileNamePrefix: "付款台账",
      columns: PAYMENT_LEDGER_COLUMNS,
      rows,
      columnKeys: normalized.columnKeys,
      filters: normalized,
      visibleProjectCount: visibleProjectIds?.length ?? 0
    });
  }

  private rowsByPaymentView(
    rows: Awaited<ReturnType<PaymentReadService["listRecent"]>>["rows"]
  ) {
    return {
      formal_ledger: rows.filter((row) => row.ledgerView === "formal_ledger"),
      my_drafts: [],
      returned_for_revision: rows.filter(
        (row) =>
          row.ledgerView === "returned_for_revision" &&
          row.availableActions.includes("abandon_application")
      ),
      ended: rows.filter((row) => row.ledgerView === "ended")
    } satisfies Record<PaymentLedgerView, typeof rows>;
  }

  private async readLedgerRows(
    visibleProjectIds: string[] | undefined,
    actorUserId: string,
    query: NormalizedLedgerExportQuery
  ) {
    // 同一读模型：listRecent 已完成逐行可见性过滤，之后才允许筛选/排序。
    const ledger = await this.listRecent(undefined, visibleProjectIds, {
      all: true,
      actorUserId
    });
    const rows = ledger.rows.filter((row) =>
      matchesLedgerExportQuery(
        {
          projectId: row.projectId,
          occurredAt: row.lifecycleUpdatedAt,
          status: `${row.approvalStatus} ${row.paymentStatus}`,
          keywordParts: [
            row.paymentNo,
            row.contractNo,
            row.settlementNo,
            row.project,
            row.approvalStatus,
            row.paymentStatus,
            row.currentNode,
            row.pendingOwner,
            row.nextAction,
            row.signingParty,
            row.counterparty
          ]
        },
        query
      )
    );
    return sortLedgerRows(rows, query.sortField, query.sortDirection, {
      updatedAt: (row) => new Date(row.lifecycleUpdatedAt),
      requestedAmountCents: (row) => Number(row.requestedAmountCents),
      paidAmountCents: (row) => Number(row.paidAmountCents),
      project: (row) => row.project,
      paymentNo: (row) => row.paymentNo
    });
  }

  /** This projection runs only after the existing Detail read authorization.
   * Domain ownership never depends on actor permission or available funds. */
  private async registeredDetailCapability(paymentId: string, actorUserId?: string): Promise<RegisteredExecutionCapability | undefined> {
    if (!this.payments || !actorUserId) return undefined;
    const capability = await this.prisma.$transaction(async tx => {
      const unsupported: RegisteredExecutionCapability = { supportedDomain: false, allowedActor: false, workflowReady: false, canSupplementVoucher: false, blockedReason: null };
      const domain = await currentRegisteredPaymentDomain(tx,paymentId);
      if (!domain.supportedDomain || !domain.payment) return unsupported;
      if (!(await registeredPaymentInstalled(tx))) return unsupported;
      const {payment,version,executions} = domain;
      let allowedActor = true;
      try { await assertRegisteredPaymentActor(tx,actorUserId); }
      catch (error) { if (!(error instanceof ForbiddenException)) throw error; allowedActor = false; }
      const contract = await tx.contract.findUnique({where:{id:payment.contractId}});
      const round = await currentRegisteredPaymentApproval(tx,payment.id);
      const frozenContractReady = Boolean(contract && version && version.contractId === contract.id && contract.projectId === payment.projectId && version.signingSubjectType === "our_company" && version.companyEntityIdSnapshot && version.companyEntityNameSnapshot && version.companyEntityCreditCodeSnapshot);
      const remaining = (payment.approvedAmountCents ?? payment.requestedAmountCents) - payment.paidAmountCents;
      const workflowReady = payment.remainingWithdrawnCents == null && frozenContractReady && Boolean(round) && ["approved_pending_payment","partially_paid"].includes(payment.status) && remaining > 0n;
      let canSupplementVoucher = false;
      if (allowedActor && executions.length) {
        const receipts = await tx.registeredPaymentFunding.findMany({where:{executionId:{in:executions.map(row=>row.id)}}});
        for (const execution of executions) if (receipts.some(row=>row.executionId === execution.id) && await paymentExecutionVoucherFileId(tx,execution) === null) { canSupplementVoucher = true; break; }
      }
      const blockedReason = !allowedActor ? "当前账号无统一实付办理权限，请联系有权财务或综合部主管办理"
        : !frozenContractReady ? "付款申请的冻结主体依据尚未齐备，请核对原资料"
        : !round ? "当前付款审批尚未通过，请核对最新审批轮次"
        : !workflowReady ? "当前申请已付清或已关闭，不能新增实付登记" : null;
      return {supportedDomain:true,allowedActor,workflowReady,canSupplementVoucher,blockedReason};
    },{isolationLevel:"Serializable"});
    if (capability.supportedDomain && capability.allowedActor && capability.workflowReady) {
      try { await this.payments.registeredExecutionOptions(paymentId,actorUserId); }
      catch (error) {
        if (error instanceof ForbiddenException) return {...capability,allowedActor:false,canSupplementVoucher:false,blockedReason:"当前账号无统一实付办理权限，请联系有权财务或综合部主管办理"};
        if (error instanceof ConflictException) return {...capability,workflowReady:false,blockedReason:error.message};
        throw error;
      }
    }
    return capability;
  }

  async getDetail(
    paymentId: string,
    visibleProjectIds?: string[],
    actorUserId?: string
  ): Promise<PaymentDetailReadModel & PaymentDetailLifecycleProjection> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(paymentId);
    }

    const payment = await this.prisma.paymentRequest.findFirst({
      where: {
        OR: [{ id: paymentId }, { code: paymentId }]
      }
    });

    if (!payment) {
      throw new NotFoundException("未找到付款申请，请刷新付款台账后重试");
    }
    const roleKeys = await this.actorRoleKeys(actorUserId, payment.projectId);
    const currentApprovalReview = await this.canReviewCurrentApproval(
      "payment_request",
      payment.id,
      payment.projectId,
      roleKeys,
      actorUserId
    );
    if (actorUserId && !currentApprovalReview.access.canAct && !(await sensitiveBusinessReadAllowed(this.prisma, "payment_request", payment.id, actorUserId, roleKeys))) {
      throw new NotFoundException("未找到付款申请，请刷新付款台账后重试");
    }
    const ledgerVisible =
      visibleProjectIds === undefined ||
      visibleProjectIds.includes(payment.projectId);
    const currentApprovalActor =
      payment.status === "approval_pending" &&
      currentApprovalReview.access.canAct;
    if (!ledgerVisible && !currentApprovalActor) {
      throw new NotFoundException("未找到付款申请，请刷新付款台账后重试");
    }
    const registeredExecutionCapability = await this.registeredDetailCapability(payment.id,actorUserId);

    const isContractAdvance = payment.sourceType === "contract_advance";
    const isSignedSettlementPayment = payment.sourceType === "signed_settlement";
    const isContractLevelPayment = isContractAdvance || payment.sourceType === "contract_due" ||
      (!payment.settlementId && !isSignedSettlementPayment);
    const [settlement, signedSettlement, contract, contractVersion, terms, activity] = await Promise.all([
      payment.settlementId
        ? this.prisma.settlement.findUnique({ where: { id: payment.settlementId } })
        : Promise.resolve(null),
      payment.signedSettlementId
        ? this.prisma.signedContractSettlement.findUnique({ where: { id: payment.signedSettlementId } })
        : Promise.resolve(null),
      isContractLevelPayment || isSignedSettlementPayment
        ? this.prisma.contract.findUnique({ where: { id: payment.contractId } })
        : Promise.resolve(null),
      this.prisma.contractVersion.findUnique({ where: { id: payment.contractVersionId } }),
      this.prisma.paymentTermsVersion.findUnique({
        where: { id: payment.paymentTermsVersionId }
      }),
      this.prisma.$queryRaw<PaymentDetailActivity[]>`
        SELECT * FROM public.jg_read_payment_detail_activity_v1(${payment.id}::text, ${payment.projectId}::text, ${payment.contractId}::text)
      `
    ]);
    const executions = activity.filter(row => row.kind === "execution");
    const financeRecords = activity.filter(row => row.kind === "finance");

    if (payment.settlementId && !settlement) {
      throw new NotFoundException("未找到关联结算，请先核对结算归档记录");
    }
    if (payment.signedSettlementId && !signedSettlement) {
      throw new NotFoundException("未找到关联的已签结算，请先核对结算登记记录");
    }

    if (!contractVersion) {
      throw new NotFoundException("未找到关联合同版本，请先核对合同归档记录");
    }

    if (!terms) {
      throw new NotFoundException("未找到合同付款条款版本，请先核对合同归档记录");
    }
    const currentSignedSettlementBasis = payment.signedSettlementId
      ? await loadSignedSettlementPaymentBasis(
          this.prisma as unknown as Prisma.TransactionClient,
          payment.contractId
        )
      : null;
    const [agreement] = await this.prisma.$queryRaw<Array<{ submittedText: string | null; currentText: string | null }>>`
      SELECT "submittedText", "currentText"
      FROM public.jg_read_payment_contract_agreement_detail_v1(${payment.id}::text, ${payment.projectId}::text, ${payment.contractId}::text)
    `;
    const effectiveTerms = !agreement?.currentText && terms.status === "superseded"
      ? await this.prisma.paymentTermsVersion.findFirst({
          where: { contractId: payment.contractId, status: "effective" },
          orderBy: { versionNo: "desc" },
          select: { originalText: true }
        })
      : null;
    if (payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS && !agreement?.submittedText) {
      throw new NotFoundException("付款申请缺少提交时冻结的合同付款约定，请核对原申请");
    }
    const submittedAgreement = agreement?.submittedText ?? terms.originalText;
    const currentAgreement = agreement?.currentText ?? effectiveTerms?.originalText ?? terms.originalText;
    const agreementChanged = currentAgreement !== submittedAgreement;
    const stage = payment.paymentTermsStageId
      ? await this.prisma.paymentTermsStage.findUnique({
          where: { id: payment.paymentTermsStageId }
        })
      : await this.prisma.paymentTermsStage.findFirst({
          where: isContractAdvance
            ? {
                paymentTermsVersionId: terms.id,
                stageType: "advance",
                basis: "contract_amount",
                triggerAnchor: "contract_effective"
              }
            : {
                paymentTermsVersionId: terms.id,
                ...(payment.sourceType === "contract_due"
                  ? { basis: "current_settlement" }
                  : {})
              },
          orderBy: { createdAt: "asc" }
        });
    if (
      payment.paymentTermsStageId &&
      (!stage || stage.paymentTermsVersionId !== terms.id)
    ) {
      throw new NotFoundException("付款申请冻结的付款阶段与付款条款不一致，请联系管理员核对");
    }
    const directPaymentRows =
      payment.sourceType === "contract_due"
        ? await this.prisma.paymentRequest.findMany({
            where: {
              contractId: payment.contractId,
              sourceType: "contract_due",
              status: {
                in: [
                  ...SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
                  "paid"
                ]
              }
            },
            select: {
              sourceType: true,
              status: true,
              requestedAmountCents: true,
              approvedAmountCents: true,
              paidAmountCents: true
            }
          })
        : [];
    const paymentDirectSummary =
      payment.sourceType === "contract_due"
        ? {
            ...directPaymentSummary(
              contractVersion.amountLimitType,
              directPaymentRows
            ),
            afterCurrentRequestCents: moneyCentsToApi(
              sumMoneyCents(
                directPaymentRows.map(
                  (row) => row.requestedAmountCents
                )
              )
            ),
            paymentMatter: payment.paymentMatter ?? null,
            amountCalculationExplanation:
              payment.amountCalculationExplanation ?? null
          }
        : undefined;
    const executionAmountCents = sumDbMoneyToBigInt(
      executions.map((execution) => execution.amountCents),
      "付款实付金额"
    );
    const refundRows = await this.readPaymentRefunds([payment.id]);
    const refundedAmountCents = refundRows.reduce((sum, row) => sum + row.amountCents, 0n);
    const correctionRows = await this.readPaymentCorrectionDeltas([payment.id]);
    const correctionDeltaCents = correctionRows.reduce((sum, row) => sum + row.amountDeltaCents, 0n);
    const executionAllocations = await this.prisma.$queryRaw<Array<{
      id: string; paymentExecutionId: string; settlementId: string | null; stageName: string | null;
      stageType: string | null; allocationType: string; amountCents: bigint; allocationOrder: number;
    }>>`
      SELECT * FROM public.jg_read_payment_detail_allocations_v1(${payment.id}::text, ${payment.projectId}::text, ${payment.contractId}::text)
    `;
    const allocationSettlementIds = [
      ...new Set(
        executionAllocations
          .map((allocation) => allocation.settlementId)
          .filter((settlementId): settlementId is string => typeof settlementId === "string")
      )
    ];
    const allocationSettlements = allocationSettlementIds.length
      ? await this.prisma.settlement.findMany({
          where: { id: { in: allocationSettlementIds } },
          select: { id: true, code: true, periodLabel: true }
        })
      : [];
    const settlementByAllocationId = new Map(
      allocationSettlements.map((allocationSettlement) => [
        allocationSettlement.id,
        allocationSettlement
      ])
    );
    const financeRecordedAmountCents = sumDbMoneyToBigInt(
      financeRecords.map((record) => record.amountCents),
      "财务入账金额"
    );
    const [evidenceFiles, approvalTimeline, latestApproval] = await Promise.all([
      this.paymentEvidenceFiles(payment, executions),
      approvalTimelineForBusiness(this.prisma, "payment_request", payment.id),
      this.latestPaymentApproval(payment.id)
    ]);
    const actionLogClient = (this.prisma as unknown as {
      approvalActionLog?: {
        findFirst(args: {
          where: { approvalInstanceId: string; action: string; actorUserId?: string };
          select: { id: true };
        }): Promise<{ id: string } | null>;
      };
    }).approvalActionLog;
    const revisionAction = paymentRevisionAction(latestApproval);
    const revisionRecord = payment.status === "draft" && latestApproval && revisionAction && actionLogClient
      ? await actionLogClient.findFirst({
          where: {
            approvalInstanceId: latestApproval.id,
            action: revisionAction,
            ...(revisionAction === "withdraw" ? { actorUserId: latestApproval.applicantUserId } : {})
          },
          select: { id: true }
        })
      : null;
    const returnedForRevision = Boolean(revisionRecord);
    const paidAmountCents = executionAmountCents + correctionDeltaCents - refundedAmountCents;
    const payableAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
    const withdrawnForRevision = returnedForRevision && revisionAction === "withdraw";
    const revisionStatus = withdrawnForRevision ? "withdrawn_for_revision" : "returned_for_revision";
    const approval = this.approvalStatusView(returnedForRevision ? revisionStatus : payment.status);
    const remainingWithdrawnCents = payment.remainingWithdrawnCents ?? null;
    const execution = remainingWithdrawnCents === null
      ? this.executionStatusView(payment.status, paidAmountCents, payableAmountCents)
      : { label: "余款已撤回", tone: "default" as const, complete: true };
    const reviewApprovalContext =
      currentApprovalReview.access.canReview &&
      payment.updatedAt instanceof Date &&
      currentApprovalReview.approval?.updatedAt instanceof Date
        ? {
            expectedPaymentUpdatedAt: payment.updatedAt.toISOString(),
            expectedApprovalInstanceId: currentApprovalReview.approval.id,
            expectedNodeIndex: currentApprovalReview.approval.currentNodeIndex,
            expectedApprovalUpdatedAt: currentApprovalReview.approval.updatedAt.toISOString(),
            ...(currentApprovalReview.approval.executionMode ? { executionMode: currentApprovalReview.approval.executionMode } : {}),
            ...(executions.length === 0 && hasPaymentRevisionBasis(payment) ? { canReturnForRevision: true as const } : {})
          }
        : null;
    const approvalReviewAccess = reviewApprovalContext
      ? currentApprovalReview.access
      : { ...currentApprovalReview.access, canReview: false };
    const canRecordExecution =
      (payment.status === "approved_pending_payment" ||
        payment.status === "partially_paid") &&
      !execution.complete
        ? await this.isActiveCurrentProjectFinanceStaff(
            actorUserId,
            payment.projectId
          )
        : false;
    const markedLatest = hasOrdinaryPaymentParallelMarker(latestApproval?.frozenNodes);
    const withdrawApprovalContext = payment.status === "approval_pending" && latestApproval?.status === "in_progress" &&
      actorUserId && latestApproval.applicantUserId === actorUserId &&
      isOrdinaryPaymentParallelRound(latestApproval.frozenNodes) && canPerform("payment.create", roleKeys)
      ? { expectedApprovalInstanceId: latestApproval.id } : undefined;
    const availableActions = this.paymentActions(
      payment.status,
      roleKeys,
      canRecordExecution,
      approvalReviewAccess,
      execution.complete,
      financeRecordedAmountCents,
      paidAmountCents,
      evidenceFiles,
      currentApprovalReview.approval?.executionMode === "parallel",
      markedLatest ? Boolean(currentApprovalReview.delegation) : approvalReviewAccess.canAct,
      !markedLatest || Boolean(withdrawApprovalContext)
    );
    const enabledExecutionActions = availableActions.filter(
      (action) => action.key === "record_execution" && action.enabled
    );
    const executionContext =
      enabledExecutionActions.length === 1 && payment.updatedAt instanceof Date
        ? { expectedPaymentUpdatedAt: payment.updatedAt.toISOString() }
        : null;
    const revisionSubmissionContext = returnedForRevision && actorUserId &&
      latestApproval?.applicantUserId === actorUserId && payment.updatedAt instanceof Date &&
      executions.length === 0 && hasPaymentRevisionBasis(payment) && canPerform("payment.create", roleKeys)
      ? {
          expectedUpdatedAt: payment.updatedAt.toISOString(),
          requestedAmountCents: moneyCentsToApi(payment.requestedAmountCents),
          paymentMatter: payment.paymentMatter,
          amountCalculationExplanation: payment.amountCalculationExplanation
        }
      : undefined;
    const remainderWithdrawalContext = payment.sourceType === "signed_settlement" &&
      payment.paymentSubjectType === "our_company" && payment.approvedAmountCents !== null &&
      remainingWithdrawnCents === null && ["approved_pending_payment", "partially_paid"].includes(payment.status) &&
      latestApproval?.status === "approved" && payment.updatedAt instanceof Date &&
      roleKeys.includes("comprehensive_director") && payableAmountCents > paidAmountCents
      ? { expectedUpdatedAt: payment.updatedAt.toISOString(), remainingAmountCents: moneyCentsToApi(payableAmountCents - paidAmountCents) }
      : undefined;
    if (remainderWithdrawalContext) availableActions.push(detailAction({
      key: "withdraw_remainder", label: "撤回并调整余款", kind: "primary", roleKeys,
      requiredAction: "payment.create", enabled: true
    }));
    if (revisionSubmissionContext) availableActions.push(detailAction({
      key: "revise_and_submit", label: "修改并重新提交", kind: "primary", roleKeys,
      requiredAction: "payment.create", enabled: true
    }));
    if (
      returnedForRevision &&
      actorUserId &&
      latestApproval?.applicantUserId === actorUserId &&
      payment.updatedAt instanceof Date
    ) {
      availableActions.push(detailAction({
        key: "abandon_application",
        label: "放弃付款申请",
        kind: "danger",
        roleKeys,
        skipRoleCheck: true,
        enabled: true
      }));
    }
    const executionBatchById = new Map(
      [...executions]
        .sort((left, right) => {
          const paidAtDiff = left.paidAt.getTime() - right.paidAt.getTime();
          if (paidAtDiff !== 0) return paidAtDiff;
          const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
          if (createdAtDiff !== 0) return createdAtDiff;
          return left.id.localeCompare(right.id);
        })
        .map((item, index) => [item.id, index + 1])
    );

    const lifecycleKind = returnedForRevision || payment.status === "abandoned"
      ? "approval_draft"
      : "formal_record";
    const ledgerView = payment.status === "abandoned"
      ? "ended"
      : returnedForRevision
        ? "returned_for_revision"
        : "formal_ledger";
    const nextStep = payment.status === "abandoned" || remainingWithdrawnCents !== null
      ? "已结束"
      : returnedForRevision
      ? "补充付款申请或放弃申请"
      : this.nextActionLabel(payment.status, execution.complete);
    const currentOwner = payment.status === "abandoned" || remainingWithdrawnCents !== null
      ? "-"
      : returnedForRevision
      ? "申请人"
      : this.currentOwnerLabel(payment.status, execution.complete);
    const returnReason = payment.status === "abandoned"
      ? (payment.abandonReason ?? "付款申请已放弃")
      : returnedForRevision
      ? (withdrawnForRevision ? "申请已撤回，可修改后重新提交" : "审批退回待修改，查看审批历史")
      : this.returnReason(payment.status);
    const blockedReasons = disabledActionReasons(availableActions);
    if (
      currentSignedSettlementBasis?.suspended &&
      remainingWithdrawnCents === null &&
      payableAmountCents - paidAmountCents > 0n
    ) {
      blockedReasons.push(
        "合同累计可付余额不足，相关未付申请已暂停；请撤回或调整未付部分，或待新结算补足后再办理"
      );
    }
    if (
      returnedForRevision &&
      actorUserId &&
      latestApproval?.applicantUserId !== actorUserId
    ) {
      blockedReasons.push("只有原申请人可以结束退回待修改的付款申请");
    }
    if (
      returnedForRevision &&
      actorUserId &&
      latestApproval?.applicantUserId === actorUserId &&
      !(payment.updatedAt instanceof Date)
    ) {
      blockedReasons.push("付款申请版本信息未读取，刷新详情后再试");
    }

    const readSnapshots = (financeHistory: boolean) => this.prisma.$queryRaw<Array<{
      sceneKey: string; entityType: string; entityId: string; revision: number; definitionVersion: number;
      definitionSnapshot: Prisma.JsonValue; valuesSnapshot: Prisma.JsonValue; frozenAt: Date;
    }>>`
      SELECT * FROM public.jg_read_payment_detail_snapshots_v1(
        ${payment.id}::text, ${payment.projectId}::text, ${payment.contractId}::text, ${financeHistory}::boolean
      )
    `;
    const financeSnapshots = financeRecords.length && canPerform("payment.finance_record", roleKeys)
      ? await readSnapshots(true) : [];
    const financeHistory: BusinessEntryFrozenSnapshot[] = financeSnapshots.map((snapshot) => ({
      sceneKey: snapshot.sceneKey,
      target: { projectId: payment.projectId, entityType: snapshot.entityType, entityId: snapshot.entityId },
      revision: snapshot.revision, definitionVersion: snapshot.definitionVersion,
      definition: snapshot.definitionSnapshot as unknown as BusinessEntrySceneDefinition,
      values: snapshot.valuesSnapshot as unknown as Record<string, unknown>, frozenAt: snapshot.frozenAt.toISOString()
    }));
    const requestSnapshots = await readSnapshots(false);
    const businessEntryHistory: BusinessEntryFrozenSnapshot[] = requestSnapshots.map((snapshot) => ({
      sceneKey: snapshot.sceneKey,
      target: { projectId: payment.projectId, entityType: snapshot.entityType, entityId: snapshot.entityId },
      revision: snapshot.revision, definitionVersion: snapshot.definitionVersion,
      definition: snapshot.definitionSnapshot as unknown as BusinessEntrySceneDefinition,
      values: snapshot.valuesSnapshot as unknown as Record<string, unknown>, frozenAt: snapshot.frozenAt.toISOString()
    }));
    return {
      projectId:payment.projectId,
      id: payment.code,
      businessEntryHistory,
      financeEntry: { definition: PAYMENT_FINANCE_ENTRY_DEFINITION, history: financeHistory },
      title: isContractAdvance
        ? `${payment.code} · 合同预付款申请`
        : payment.sourceType === "contract_due"
          ? payment.paymentTermsStageId
            ? `${payment.code} · 合同冻结阶段直接付款申请`
            : payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS
              ? `${payment.code} · 按合同约定直接付款申请`
              : `${payment.code} · 合同累计结算付款申请`
        : isSignedSettlementPayment
          ? `${payment.code} · ${signedSettlement?.number ?? "已签结算"}付款申请`
          : `${payment.code} · ${settlement?.periodLabel}付款申请`,
      meta: [
        { label: "审批状态", value: approval.label, tone: approval.tone },
        { label: "实付状态", value: execution.label, tone: execution.tone },
        { label: "付款条款版本", value: `v${terms.versionNo} 随合同生效` },
        ...(agreementChanged
          ? [{ label: "付款约定", value: "约定已更新，请核对提交时和最新约定" }]
          : []),
        { label: "关联合同版本", value: `合同 v${contractVersion.versionNo}` },
        { label: "合同分类", value: CONTRACT_RELATIONSHIP_LABELS[downstreamContractRelationship(contractVersion)] },
        { label: "责任部门", value: "财务部" },
        { label: "下一步动作", value: nextStep, tone: execution.tone }
      ],
      baseInfo: [
        { label: "付款编号", value: payment.code },
        ...(isSignedSettlementPayment
          ? [
              { label: "付款来源", value: "已签结算最近确认一期" },
              {
                label: "关联合同",
                value: `${contract?.code ?? payment.contractId} · ${contract?.name ?? payment.contractId}`
              },
              {
                label: "已签结算依据",
                value: `${signedSettlement?.number ?? payment.signedSettlementId} · 确认序号 ${
                  payment.signedSettlementConfirmationNo?.toString() ?? "-"
                }`
              },
              {
                label: "依据快照",
                value: `本期 ${payment.signedSettlementConfirmedYuan?.toFixed(4) ?? "-"} 元 · 发起时合同累计 ${
                  payment.signedSettlementContractConfirmedYuan?.toFixed(4) ?? "-"
                } 元`
              },
              ...(currentSignedSettlementBasis
                ? [
                    {
                      label: "当前合同累计",
                      value: `${currentSignedSettlementBasis.confirmedContractYuan.toFixed(4)} 元${
                        currentSignedSettlementBasis.latestConfirmed.id === payment.signedSettlementId
                          ? ""
                          : " · 最新确认已变化"
                      }${
                        currentSignedSettlementBasis.remainingCents === 0n
                          ? " · 当前无可付余额"
                          : ""
                      }`
                    },
                    {
                      label: "已付（含预付款）",
                      value: `${formatMoneyCentsAsYuan(currentSignedSettlementBasis.netPaidCents)} 元`
                    },
                    {
                      label: "在途未付占用",
                      value: `${formatMoneyCentsAsYuan(currentSignedSettlementBasis.outstandingCents)} 元`
                    },
                    currentSignedSettlementBasis.overpayCents > 0n
                      ? {
                          label: "超付差额",
                          value: `${formatMoneyCentsAsYuan(currentSignedSettlementBasis.overpayCents)} 元`
                        }
                      : {
                          label: "可付余额",
                          value: `${formatMoneyCentsAsYuan(currentSignedSettlementBasis.remainingCents)} 元`
                        },
                    ...(currentSignedSettlementBasis.unsettledAdvanceCents > 0n
                      ? [
                          {
                            label: "尚未结算预付款",
                            value: `${formatMoneyCentsAsYuan(currentSignedSettlementBasis.unsettledAdvanceCents)} 元`
                          }
                        ]
                      : []),
                    ...(currentSignedSettlementBasis.abnormalOverpayCents > 0n
                      ? [
                          {
                            label: "异常超付",
                            value: `${formatMoneyCentsAsYuan(currentSignedSettlementBasis.abnormalOverpayCents)} 元`
                          }
                        ]
                      : []),
                    {
                      label: "容量状态",
                      value: currentSignedSettlementBasis.suspended
                        ? "已暂停：合同累计可付余额不足"
                        : "正常"
                    }
                  ]
                : [])
            ]
          : isContractLevelPayment
          ? [
              {
                label: "付款来源",
                value: payment.paymentTermsStageId && payment.sourceType === "contract_due"
                  ? "合同冻结阶段直接付款"
                  : payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS
                    ? "按合同约定直接付款" : this.paymentSourceLabel(payment.sourceType)
              },
              {
                label: "关联合同",
                value: `${contract?.code ?? payment.contractId} · ${contract?.name ?? payment.contractId}`
              }
            ]
          : [
              {
                label: "关联结算",
                value: `${settlement?.code ?? payment.settlementId} · ${settlement?.periodLabel ?? ""}结算单`
              },
              { label: "结算状态", value: this.settlementStatusLabel(settlement?.status ?? "") }
            ]),
        ...(agreementChanged
          ? [
              { label: "提交时付款约定", value: submittedAgreement || "未填写" },
              { label: "最新付款约定", value: currentAgreement || "未填写" }
            ]
          : currentAgreement ? [{ label: "付款约定原文", value: currentAgreement }] : []),
        { label: "付款阶段", value: stage?.name ?? "按付款条款执行" },
        { label: "付款比例", value: this.ratioLabel(stage?.ratioBps ?? null) },
        { label: "付款账期", value: stage ? `${stage.dueDays}天` : "-" },
        { label: "发票要求", value: stage?.requiresInvoice ? "需提供发票" : "不要求发票" },
        { label: "申请金额", value: this.formatMoney(payment.requestedAmountCents) },
        ...(payment.approvedAmountCents === null
          ? []
          : [{ label: "批准金额", value: this.formatMoney(payment.approvedAmountCents) }]),
        ...(paymentDirectSummary?.unlimitedTotal
          ? [
              {
                label: "金额性质",
                value: "无固定总价"
              },
              {
                label: "本次付款事项",
                value: paymentDirectSummary.paymentMatter ?? "-"
              },
              {
                label: "金额计算说明",
                value:
                  paymentDirectSummary.amountCalculationExplanation ?? "-"
              },
              {
                label: "本次申请后累计",
                value: this.formatMoney(
                  BigInt(paymentDirectSummary.afterCurrentRequestCents)
                )
              }
            ]
          : []),
        { label: "已付金额", value: this.formatMoney(paidAmountCents) },
        ...(remainingWithdrawnCents === null ? [] : [
          { label: "已撤回余款", value: this.formatMoney(remainingWithdrawnCents) }
        ]),
        ...(refundedAmountCents > 0n
          ? [
              { label: "已退金额", value: this.formatMoney(refundedAmountCents) },
              { label: "原实付合计", value: this.formatMoney(executionAmountCents) }
            ]
          : [])
      ],
      paidAmountCents: moneyCentsToApi(paidAmountCents),
      grossPaidAmountCents: moneyCentsToApi(executionAmountCents),
      refundedAmountCents: moneyCentsToApi(refundedAmountCents),
      correctionDeltaCents: moneyCentsToApi(correctionDeltaCents),
      refunds: refundRows.map(row => ({ id: row.id, paymentExecutionId: row.paymentExecutionId, amountCents: moneyCentsToApi(row.amountCents), receivedAt: chinaDateOnly(row.receivedAt), fundRegistrationId: row.fundRegistrationId })),
      approvalSteps: this.approvalSteps(payment.status),
      executionSteps: this.executionSteps(
        payment.status,
        paidAmountCents,
        payableAmountCents,
        financeRecordedAmountCents
      ),
      executionAllocations: executionAllocations.map((allocation) => {
        const allocationSettlement = allocation.settlementId
          ? settlementByAllocationId.get(allocation.settlementId)
          : undefined;

        return {
          id: allocation.id,
          executionCode: `${payment.code} · 第${
            executionBatchById.get(allocation.paymentExecutionId) ?? allocation.allocationOrder + 1
          }笔`,
          settlementNo: allocationSettlement
            ? `${allocationSettlement.code} · ${allocationSettlement.periodLabel}`
            : (allocation.settlementId ?? "-"),
          stageName: allocation.stageType === null
            ? "付款申请批准金额" : allocation.stageName ?? allocation.stageType,
          allocationType:
            payment.paymentTermsStageId && allocation.allocationType === "contract_due_payment"
              ? "合同冻结阶段直接付款"
              : allocation.stageType === null
                ? "按合同约定直接付款" : this.allocationTypeLabel(allocation.allocationType),
          amountCents: moneyCentsToApi(allocation.amountCents)
        };
      }),
      evidenceFiles,
      approvalTimeline,
      availableActions,
      availableActionKeys: availableActions
        .filter((action) => action.enabled)
        .map((action) => action.key),
      reviewApprovalContext,
      executionContext,
      ...(withdrawApprovalContext ? { withdrawApprovalContext } : {}),
      ...(remainderWithdrawalContext ? { remainderWithdrawalContext } : {}),
      ...(currentApprovalReview.delegation ? { delegationApprovalContext: currentApprovalReview.delegation } : {}),
      ...(revisionSubmissionContext ? { revisionSubmissionContext } : {}),
      lifecycleKind,
      ledgerView,
      nextStep,
      currentOwner,
      returnReason,
      primaryAction: primaryActionKey(availableActions),
      disabledReasons: disabledActionReasons(availableActions),
      blockedReasons,
      lifecycleUpdatedAt: payment.updatedAt instanceof Date ? payment.updatedAt.toISOString() : null,
      executionCoverages: this.executionCoverages(payment.code, executions, financeRecords, evidenceFiles),
      ...(registeredExecutionCapability ? {registeredExecutionCapability} : {}),
      traceRules: [
        isContractAdvance
          ? "预付款按合同生效日和账期计算，不依赖结算单"
          : payment.sourceType === "contract_due"
            ? payment.paymentTermsStageId
              ? "付款申请按合同冻结付款阶段执行，实付沿用申请时冻结的付款条款与阶段"
              : payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS
                ? "实付按申请时保存的合同约定和本次批准金额办理，可以分次登记"
                : "付款申请按合同下全部已生效结算累计计算，实付后自动生成分摊台账"
          : "付款申请只能来自已生效结算",
        "审批通过进入已批待付",
        "审批通过不等于实际付款完成",
        registeredExecutionCapability?.supportedDomain
          ? registeredExecutionCapability.allowedActor && (registeredExecutionCapability.workflowReady || registeredExecutionCapability.canSupplementVoucher)
            ? "系统外已实际付款后在统一办理区登记，电子凭证可后补并标待补充；实付及补充均保留审计"
            : registeredExecutionCapability.blockedReason ?? "当前申请不能新增统一实付登记，请核对原业务状态"
          : "实付登记必须上传付款凭证并写入审计日志"
      ],
      executionBlockMessage: registeredExecutionCapability?.supportedDomain
        ? !registeredExecutionCapability.allowedActor ? registeredExecutionCapability.blockedReason ?? "请联系有权财务或综合部主管办理"
          : registeredExecutionCapability.canSupplementVoucher ? "实际付款已经登记，电子凭证可后补；请在统一办理区查看原记录，不重复登记付款。"
          : registeredExecutionCapability.workflowReady ? "系统外已实际付款后在统一办理区登记金额、实际日期和资金来源；电子凭证可后补并标待补充。"
          : registeredExecutionCapability.blockedReason ?? "当前申请不能新增统一实付登记，请核对原业务状态"
        : this.executionBlockMessage(payment.status, execution.complete),
      ...(paymentDirectSummary
        ? { directPaymentSummary: paymentDirectSummary }
        : {}),
      chainLinks: [
        isSignedSettlementPayment
          ? {
              label: "关联已签结算",
              to: `/结算工作台/已签登记?projectId=${encodeURIComponent(payment.projectId)}&settlementId=${encodeURIComponent(payment.signedSettlementId ?? "")}`
            }
          : isContractLevelPayment
            ? { label: "关联合同", to: `/contracts/${contract?.code ?? payment.contractId}` }
            : { label: "关联结算", to: `/settlements/${settlement?.code ?? payment.settlementId}` },
        { label: "付款凭证", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  async getContractApplication(
    contractVersionId: string,
    rawAsOf?: string
  ): Promise<ContractPaymentApplicationPreviewReadModel> {
    if (!contractVersionId) {
      throw new BadRequestException("请选择要申请付款的合同版本");
    }

    const asOf = rawAsOf ? new Date(rawAsOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      throw new BadRequestException("付款申请基准日期格式不正确，请重新选择日期");
    }

    const contractVersion = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!contractVersion) {
      throw new NotFoundException("未找到合同版本，请刷新合同台账后重试");
    }
    if (contractVersion.status !== "effective") {
      throw new BadRequestException("当前合同版本尚未归档生效，不能发起付款申请");
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractVersion.contractId }
    });
    if (!contract) {
      throw new NotFoundException("未找到关联合同，请先核对合同台账");
    }
    const textAgreementContract = isConfirmedTextAgreementContract(contract, contractVersion);
    if (contract.contractTypeKey !== "generic_contract" && !textAgreementContract) {
      throw new BadRequestException("该合同类型应从生效结算发起付款");
    }
    if (contractVersion.settlementMode !== undefined) {
      if (
        !isContractSettlementMode(contractVersion.settlementMode) ||
        !contractVersion.settlementModeConfirmedAt
      ) {
        throw new BadRequestException(
          "合同结算方式尚未由合同部主管确认，不能按合同发起应付款"
        );
      }
      if (contractVersion.settlementMode !== "direct_payment") {
        throw new BadRequestException(
          "该合同已确认需要结算，应从生效结算发起付款"
        );
      }
    }

    const project = await this.prisma.project.findUnique({
      where: { id: contract.projectId }
    });

    const settlements = await this.prisma.settlement.findMany({
      where: {
        contractId: contract.id,
        status: { in: [...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES] }
      },
      orderBy: { createdAt: "asc" }
    });
    const settlementIds = settlements.map((settlement) => settlement.id);
    const settlementTermsVersionIds = settlements.map((settlement) => settlement.paymentTermsVersionId);
    const paymentTermsVersions = await this.prisma.paymentTermsVersion.findMany({
      where: {
        contractVersionId: contractVersion.id,
        status: "effective"
      },
      select: { id: true, originalText: true },
      orderBy: { versionNo: "desc" }
    });
    const selectedTerms = paymentTermsVersions[0];
    const paymentTermsVersionId = selectedTerms?.id;
    if (!paymentTermsVersionId) {
      throw new BadRequestException("未找到已生效的付款条款，请先补齐合同付款条款");
    }
    const textAgreement = textAgreementContract && selectedTerms.originalText?.trim() &&
      !await this.prisma.paymentTermsStage.findFirst({ where: { paymentTermsVersionId }, select: { id: true } })
      ? await readTextPaymentAgreement(this.prisma, {
          contractVersionId, paymentTermsVersionId, contractId: contract.id, projectId: contract.projectId
        })
      : null;
    const textContractLimit = textAgreement
      ? await readTextAgreementContractLimit(this.prisma, contractVersion, contract.projectId)
      : null;
    const historicalBalance = await this.confirmedHistoricalBalanceForContract(contract.id);
    const paymentTermsVersionIds = [
      ...new Set([
        ...settlementTermsVersionIds,
        ...paymentTermsVersions.map((terms) => terms.id),
        ...(historicalBalance?.paymentTermsVersionId ? [historicalBalance.paymentTermsVersionId] : [])
      ])
    ];

    const [
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests,
      projectProxyPayments,
      settlementContractVersions
    ] = await Promise.all([
      paymentTermsVersionIds.length
        ? this.prisma.paymentTermsStage.findMany({
            where: {
              paymentTermsVersionId: { in: paymentTermsVersionIds },
              basis: "contract_amount",
              triggerAnchor: "contract_effective",
              stageType: { not: "advance" }
            },
            select: {
              id: true,
              paymentTermsVersionId: true,
              name: true,
              stageType: true,
              basis: true,
              ratioBps: true,
              fixedAmountCents: true,
              triggerAnchor: true,
              triggerEvent: true,
              dueDays: true,
              advanceDeductionMode: true,
              advanceDeductionRatioBps: true,
              advanceDeductionStartRatioBps: true,
              requiresInvoice: true,
              allowsEarlyPayment: true,
              allowsInstallments: true
            }
          })
        : Promise.resolve([]),
      loadSettlementPaymentConfirmationFacts(this.prisma, settlementIds),
      this.prisma.paymentRequest.findMany({
        where: {
          contractId: contract.id,
          status: {
            in: [
              ...SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
              "paid"
            ]
          }
        },
        select: {
          settlementId: true,
          sourceType: true,
          paymentTermsVersionId: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true,
          remainingWithdrawnCents: true,
          paymentTermsStageId: true
        }
      }),
      this.prisma.projectProxyPayment.findMany({
        where: {
          voidedAt: null,
          OR: [
            { contractId: contract.id },
            ...(settlementIds.length ? [{ settlementId: { in: settlementIds } }] : [])
          ]
        },
        select: { amountCents: true }
      }),
      settlements.length
        ? this.prisma.contractVersion.findMany({
            where: {
              id: {
                in: [
                  ...new Set(
                    settlements.map((settlement) => settlement.contractVersionId)
                  )
                ]
              }
            },
            select: { id: true, amountCents: true }
          })
        : Promise.resolve([])
    ]);
    const contractAmountCentsByVersionId = new Map(
      settlementContractVersions.map((version) => [
        version.id,
        dbMoneyToBigInt(version.amountCents, "合同金额")
      ])
    );
    const contractAmountCentsByPaymentTermsVersionId = settlements.reduce<Record<string, bigint>>(
      (amounts, settlement) => ({
        ...amounts,
        [settlement.paymentTermsVersionId]:
          contractAmountCentsByVersionId.get(settlement.contractVersionId) ??
          dbMoneyToBigInt(contractVersion.amountCents, "合同金额")
      }),
      {}
    );
    for (const terms of paymentTermsVersions) {
      contractAmountCentsByPaymentTermsVersionId[terms.id] =
        contractAmountCentsByPaymentTermsVersionId[terms.id] ??
        dbMoneyToBigInt(contractVersion.amountCents, "合同金额");
    }
    if (historicalBalance?.paymentTermsVersionId) {
      contractAmountCentsByPaymentTermsVersionId[historicalBalance.paymentTermsVersionId] =
        contractAmountCentsByPaymentTermsVersionId[historicalBalance.paymentTermsVersionId] ??
        dbMoneyToBigInt(contractVersion.amountCents, "合同金额");
    }

    const settlementPaymentRequests = paymentRequests.filter(
      (payment) =>
        payment.sourceType === "settlement" ||
        payment.sourceType === "contract_due" ||
        payment.settlementId
    );
    const advancePaymentRequests = paymentRequests.filter(
      (payment) =>
        payment.sourceType === "contract_advance" &&
        payment.paidAmountCents > 0n &&
        payment.paymentTermsVersionId
    );
    const proxyPaidCents = sumMoneyCents(
      projectProxyPayments.map((payment) => payment.amountCents)
    ) + await contractProxyPaidForContract(this.prisma as unknown as Prisma.TransactionClient, contractVersion.contractId);
    const preview = buildContractPaymentApplicationPreview({
      asOf,
      contractEffectiveAt: contractVersion.effectiveAt,
      settlements,
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests: settlementPaymentRequests,
      proxyPaidAmountCents: proxyPaidCents,
      contractAmountCents: dbMoneyToBigInt(contractVersion.amountCents, "合同金额"),
      contractAmountCentsByPaymentTermsVersionId,
      advancePaymentRequests,
      historicalBalance
    });
    const eligibleStages = paymentTermsStages.filter(
      (stage) => {
        const hasValidRatio =
          stage.ratioBps !== null &&
          Number.isInteger(stage.ratioBps) &&
          stage.ratioBps > 0 &&
          stage.ratioBps <= 10000;
        const hasValidFixedAmount =
          stage.fixedAmountCents !== null && stage.fixedAmountCents > 0n;
        return (
        stage.paymentTermsVersionId === paymentTermsVersionId &&
        stage.stageType !== "advance" &&
        stage.basis === "contract_amount" &&
        stage.triggerAnchor === "contract_effective" &&
          hasValidRatio !== hasValidFixedAmount &&
          Number.isSafeInteger(stage.dueDays) &&
          stage.dueDays >= 0
        );
      }
    );
    const directContractAmountCents = textAgreement
      ? textContractLimit ?? 0n : dbMoneyToBigInt(contractVersion.amountCents, "合同金额");
    const genericStageCapacity = this.genericContractStageCapacity({
      asOf,
      contractEffectiveAt: contractVersion.effectiveAt,
      contractAmountCents: directContractAmountCents,
      stages: eligibleStages,
      paymentRequests,
      externalOccupancyCents:
        proxyPaidCents + this.historicalConservativeOccupancyCents(historicalBalance)
    });
    const genericContractRemainingCents = directContractAmountCents - genericStageCapacity.contractOccupiedCents;
    const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));
    const occupancy = this.paymentOccupancyBreakdown(settlementPaymentRequests);
    const actualPaidCents =
      sumMoneyCents(settlements.map((settlement) => settlement.paidAmountCents)) +
      sumMoneyCents(
        settlementPaymentRequests
          .filter((payment) => payment.settlementId === null)
          .map((payment) => payment.paidAmountCents)
      );

    const capacity = {
      ...preview.capacity,
      ...(eligibleStages.length
        ? {
            duePayableCents: moneyCentsToApi(genericStageCapacity.duePayableCents),
            occupiedCents: moneyCentsToApi(genericStageCapacity.occupiedCents),
            maxRequestableCents: moneyCentsToApi(genericStageCapacity.maxRequestableCents)
          }
        : {}),
      actualPaidCents: moneyCentsToApi(actualPaidCents),
      approvalPendingCents: moneyCentsToApi(occupancy.approvalPendingCents),
      approvedPendingCents: moneyCentsToApi(occupancy.approvedPendingCents),
      proxyPaidCents: moneyCentsToApi(proxyPaidCents),
      ...(preview.historicalBalance
        ? {
            historicalPaidCents: settlements.some(
              (settlement) =>
                settlement.sourceType === "historical_takeover" ||
                !!settlement.sourceTakeoverId
            )
              ? "0"
              : preview.historicalBalance.paidCents,
            historicalApprovalPendingCents:
              preview.historicalBalance.approvalPendingPaymentCents,
            historicalApprovedPendingCents:
              preview.historicalBalance.approvedPendingPaymentCents,
            historicalProxyPaidCents: preview.historicalBalance.proxyPaidCents,
            historicalRetentionWithheldCents: preview.historicalBalance.retentionWithheldCents,
            historicalRetentionReleasedCents: preview.historicalBalance.retentionReleasedCents,
            historicalOtherConfirmedOccupancyCents:
              preview.historicalBalance.otherConfirmedOccupancyCents
          }
        : {})
    };
    const contractDirectPaymentSummary = directPaymentSummary(
      textAgreement && textContractLimit === null ? "unlimited" : contractVersion.amountLimitType,
      paymentRequests
    );
    const unlimitedDirectPayment =
      contractDirectPaymentSummary.unlimitedTotal;

    return {
      contract: {
        contractId: contract.id,
        contractVersionId: contractVersion.id,
        contractNo: contract.code ?? contract.temporaryCode ?? contract.id,
        contractName: contract.name,
        contractVersion: `合同 v${contractVersion.versionNo}`,
        contractTypeKey: contract.contractTypeKey,
        projectId: contract.projectId,
        projectName: project?.name ?? contract.projectId
      },
      paymentMode: textAgreement ? "text_agreement" : "generic_contract_stage",
      ...(textAgreement ? { textAgreement } : {}),
      genericContractCapacity: {
        contractAmountCents: textAgreement && unlimitedDirectPayment ? null : moneyCentsToApi(directContractAmountCents),
        contractOccupiedCents: moneyCentsToApi(
          genericStageCapacity.contractOccupiedCents
        ),
        contractRemainingCents: textAgreement && unlimitedDirectPayment ? null : moneyCentsToApi(
          unlimitedDirectPayment
            ? 0n
            : genericStageCapacity.contractRemainingCents
        )
      },
      directPaymentSummary: contractDirectPaymentSummary,
      availableStages: eligibleStages.map((stage) => {
        const stageCapacity = genericStageCapacity.byStageId.get(stage.id)!;
        const dueAt = contractVersion.effectiveAt
          ? new Date(
              contractVersion.effectiveAt.getTime() +
                Math.max(stage.dueDays, 0) * 24 * 60 * 60 * 1000
            )
          : null;
        const unlimitedStageOpen =
          dueAt !== null &&
          (dueAt <= asOf || stage.allowsEarlyPayment);
        return {
          paymentTermsStageId: stage.id,
          paymentTermsVersionId: stage.paymentTermsVersionId,
          name: stage.name,
          stageType: stage.stageType,
          basis: stage.basis,
          triggerAnchor: stage.triggerAnchor,
          triggerEvent: stage.triggerEvent,
          dueDays: stage.dueDays,
          requiresInvoice: stage.requiresInvoice,
          allowsInstallments: stage.allowsInstallments,
          payableCents: moneyCentsToApi(
            unlimitedDirectPayment ? 0n : stageCapacity.payableCents
          ),
          occupiedCents: moneyCentsToApi(stageCapacity.occupiedCents),
          maxRequestableCents: moneyCentsToApi(
            unlimitedDirectPayment ? 0n : stageCapacity.maxRequestableCents
          ),
          disabledReason: unlimitedDirectPayment
            ? unlimitedStageOpen
              ? null
              : "合同冻结付款阶段尚未到期"
            : stageCapacity.disabledReason
        };
      }),
      asOf: asOf.toISOString(),
      includedSettlements: settlements.map((settlement) => ({
        settlementId: settlement.id,
        settlementNo: settlement.code,
        period: settlement.periodLabel,
        amountCents: moneyCentsToApi(settlement.amountCents),
        status: settlement.status,
        isFinal: settlement.isFinal
      })),
      capacity: textAgreement ? {
        ...capacity,
        duePayableCents: null,
        occupiedCents: moneyCentsToApi(genericStageCapacity.contractOccupiedCents),
        maxRequestableCents: unlimitedDirectPayment ? null : moneyCentsToApi(genericStageCapacity.contractRemainingCents)
      } : capacity,
      advanceDeduction: preview.advanceDeduction,
      capacityExplanation: unlimitedDirectPayment
        ? [
            {
              label: "累计申请",
              amountCents:
                contractDirectPaymentSummary.cumulativeRequestedCents,
              operator: "add" as const,
              note: "无固定总价，仅作累计风险展示",
              tone: "primary" as const
            },
            {
              label: "累计批准",
              amountCents:
                contractDirectPaymentSummary.cumulativeApprovedCents,
              operator: "result" as const,
              note: "不形成合同法律金额上限",
              tone: "default" as const
            },
            {
              label: "累计实付",
              amountCents:
                contractDirectPaymentSummary.cumulativePaidCents,
              operator: "result" as const,
              note: "项目可用资金和垫资额度仍单独硬阻断",
              tone: "warning" as const
            }
          ]
        : [
            {
              label: "合同金额",
              amountCents: moneyCentsToApi(directContractAmountCents),
              operator: "add" as const,
              note: "按当前生效合同版本的金额上限",
              tone: "primary" as const
            },
            {
              label: "扣合同已占用金额",
              amountCents: moneyCentsToApi(
                genericStageCapacity.contractOccupiedCents
              ),
              operator: "subtract" as const,
              note: "含跨版本直接付款、预付款、代付和已确认历史占用",
              tone: "default" as const
            },
            {
              label: "合同当前剩余额度",
              amountCents: moneyCentsToApi(
                genericContractRemainingCents > 0n
                  ? genericContractRemainingCents
                  : 0n
              ),
              operator: "result" as const,
              note: textAgreement ? "本次申请仍须经审批" : "实际申请仍受所选冻结付款阶段额度约束",
              tone: "success" as const
            }
          ],
      ...(preview.historicalBalance ? { historicalBalance: preview.historicalBalance } : {}),
      sections: preview.sections.map((section) => ({
        type: section.type,
        title: section.title,
        rows: section.rows.map((row) => {
          const settlement = row.settlementId ? settlementById.get(row.settlementId) : undefined;

          return {
            id: row.id,
            source: settlement ? `${settlement.code} · ${settlement.periodLabel}` : row.source,
            settlementId: row.settlementId,
            settlementNo: settlement?.code ?? null,
            currentSettlementAmountCents: row.currentSettlementAmountCents,
            cumulativeBeforeAmountCents: row.cumulativeBeforeAmountCents,
            cumulativeAfterAmountCents: row.cumulativeAfterAmountCents,
            effectiveAt: this.dateOnly(row.effectiveAt),
            expectedPayableAt: this.dateOnly(row.expectedPayableAt),
            paymentRule: row.paymentRule,
            invoiceRequirement: row.requiresInvoice ? "需提供发票" : "不要求发票",
            isDue: row.isDue,
            includableAmountCents: row.includableAmountCents
          };
        })
      })),
      formula: unlimitedDirectPayment
        ? "无固定总价合同不设置合同金额上限；每次申请必须填写付款事项和金额计算说明，并继续执行完整审批、实付凭证和项目资金检查"
        : textAgreement ? "当前生效合同金额 - 合同已占用金额 = 合同当前剩余额度"
          : "当前生效合同金额 - 合同已占用金额 = 合同当前剩余额度；本次申请同时受所选冻结付款阶段约束"
    };
  }

  private genericContractStageCapacity(input: {
    asOf: Date;
    contractEffectiveAt: Date | null;
    contractAmountCents: bigint;
    stages: Array<{
      id: string;
      ratioBps: number | null;
      fixedAmountCents: bigint | null;
      dueDays: number;
      allowsEarlyPayment: boolean;
      allowsInstallments: boolean;
    }>;
    paymentRequests: Array<{
      paymentTermsStageId?: string | null;
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
      paidAmountCents: bigint;
      remainingWithdrawnCents?: bigint | null;
    }>;
    externalOccupancyCents: bigint;
  }) {
    const byStageId = new Map<
      string,
      { payableCents: bigint; occupiedCents: bigint; maxRequestableCents: bigint; disabledReason: string | null }
    >();
    let duePayableCents = 0n;
    let occupiedCents = 0n;
    let maxRequestableCents = 0n;
    const requestOccupancyCents = input.paymentRequests.reduce((total, request) => {
      const payableCents = ["approved_pending_payment", "partially_paid", "paid"].includes(
        request.status
      )
        ? (request.approvedAmountCents ?? request.requestedAmountCents)
        : request.requestedAmountCents;
      const outstandingCents = request.remainingWithdrawnCents == null ? payableCents - request.paidAmountCents : 0n;
      return total + request.paidAmountCents + (outstandingCents > 0n ? outstandingCents : 0n);
    }, 0n);
    const contractRemainingCents =
      input.contractAmountCents - requestOccupancyCents - input.externalOccupancyCents;
    const conservativeContractRemainingCents = contractRemainingCents > 0n
      ? contractRemainingCents
      : 0n;

    for (const stage of input.stages) {
      const configuredCents = stage.fixedAmountCents !== null
        ? dbMoneyToBigInt(stage.fixedAmountCents, "付款阶段固定金额")
        : (input.contractAmountCents * BigInt(Math.max(stage.ratioBps ?? 0, 0))) / 10000n;
      const payableCents = configuredCents < input.contractAmountCents
        ? configuredCents
        : input.contractAmountCents;
      const dueAt = input.contractEffectiveAt
        ? new Date(
            input.contractEffectiveAt.getTime() + Math.max(stage.dueDays, 0) * 24 * 60 * 60 * 1000
          )
        : null;
      const isDue = !!dueAt && dueAt <= input.asOf;
      const isAvailable = isDue || stage.allowsEarlyPayment;
      const stageRequests = input.paymentRequests.filter(
        (request) => request.paymentTermsStageId === stage.id
      );
      const stageOccupancy = this.paymentOccupancyBreakdown(stageRequests);
      const paidCents = sumMoneyCents(stageRequests.map((request) => request.paidAmountCents));
      const stageOccupiedCents =
        paidCents + stageOccupancy.approvalPendingCents + stageOccupancy.approvedPendingCents;
      const remainingCents = isAvailable ? payableCents - stageOccupiedCents : 0n;
      const uncappedStageMaxRequestableCents = remainingCents > 0n ? remainingCents : 0n;
      const cappedStageMaxRequestableCents = uncappedStageMaxRequestableCents < conservativeContractRemainingCents
        ? uncappedStageMaxRequestableCents
        : conservativeContractRemainingCents;
      const stageMaxRequestableCents = stage.allowsInstallments === false && stageOccupiedCents > 0n
        ? 0n
        : cappedStageMaxRequestableCents;
      const disabledReason = !input.contractEffectiveAt
        ? "合同生效日期缺失，不能核算付款阶段"
        : !isAvailable
          ? `该阶段尚未到期，预计 ${dueAt!.toISOString().slice(0, 10)} 可申请`
          : stage.allowsInstallments === false && stageOccupiedCents > 0n
            ? "该阶段不允许分次申请，已有付款申请占用该阶段额度"
          : stageMaxRequestableCents <= 0n
            ? "该阶段的可申请额度已用尽"
            : null;
      byStageId.set(stage.id, {
        payableCents: isAvailable ? payableCents : 0n,
        occupiedCents: stageOccupiedCents,
        maxRequestableCents: stageMaxRequestableCents,
        disabledReason
      });
      duePayableCents += isAvailable ? payableCents : 0n;
      occupiedCents += stageOccupiedCents;
      maxRequestableCents += stageMaxRequestableCents;
    }

    maxRequestableCents = maxRequestableCents < conservativeContractRemainingCents
      ? maxRequestableCents
      : conservativeContractRemainingCents;
    return {
      duePayableCents,
      occupiedCents,
      maxRequestableCents,
      contractOccupiedCents: requestOccupancyCents + input.externalOccupancyCents,
      contractRemainingCents: conservativeContractRemainingCents,
      byStageId
    };
  }

  private historicalConservativeOccupancyCents(
    historicalBalance: Awaited<ReturnType<PaymentReadService["confirmedHistoricalBalanceForContract"]>>
  ): bigint {
    if (!historicalBalance) return 0n;
    const advanceUnrecoveredCents =
      (historicalBalance.advancePaidCents ?? 0n) -
      (historicalBalance.advanceDeductedCents ?? 0n);
    const retentionUnreleasedCents =
      (historicalBalance.retentionWithheldCents ?? 0n) -
      (historicalBalance.retentionReleasedCents ?? 0n);
    return (historicalBalance.paidCents ?? 0n) +
      (historicalBalance.approvalPendingPaymentCents ?? 0n) +
      (historicalBalance.approvedPendingPaymentCents ?? 0n) +
      (historicalBalance.proxyPaidCents ?? 0n) +
      (advanceUnrecoveredCents > 0n ? advanceUnrecoveredCents : 0n) +
      (retentionUnreleasedCents > 0n ? retentionUnreleasedCents : 0n) +
      (historicalBalance.otherConfirmedOccupancyCents ?? 0n);
  }

  private sampleDetail(
    paymentId: string
  ): PaymentDetailReadModel & PaymentDetailLifecycleProjection {
    return {
      id: paymentId,
      title: "FK-2026-006 · 5月材料结算付款申请",
      meta: [
        { label: "审批状态", value: "已通过", tone: "success" },
        { label: "实付状态", value: "已批待付", tone: "warning" },
        { label: "付款条款版本", value: "v1 随合同生效" },
        { label: "关联合同版本", value: "合同 v1" },
        { label: "责任部门", value: "财务部" },
        { label: "下一步动作", value: "出纳付款登记", tone: "primary" }
      ],
      baseInfo: [
        { label: "付款编号", value: paymentId },
        { label: "关联结算", value: "JS-2026-018 · 5月材料结算单" },
        { label: "结算状态", value: "已生效" },
        { label: "付款阶段", value: "当期结算款" },
        { label: "付款比例", value: "80%" },
        { label: "付款账期", value: "30天" },
        { label: "申请金额", value: "¥256,000.00" },
        { label: "申请人", value: "项目经理 张工" }
      ],
      approvalSteps: [
        { label: "付款申请", status: "已提交", owner: "经办人", tone: "success" },
        { label: "综合部主管审批", status: "已通过", owner: "综合部主管", tone: "success" },
        { label: "项目经理审批", status: "已通过", owner: "项目经理", tone: "success" },
        { label: "财务总监审批", status: "已通过", owner: "财务总监", tone: "success" },
        { label: "董事长/总经理或签", status: "已通过", owner: "董事长或总经理", tone: "success" },
        { label: "审批通过", status: "已批待付", owner: "系统", tone: "warning" }
      ],
      executionSteps: [
        { label: "已批待付", status: "当前状态", owner: "财务部", tone: "warning" },
        { label: "出纳付款登记", status: "待处理", owner: "出纳/财务", tone: "primary" },
        { label: "付款凭证上传", status: "待处理", owner: "出纳/财务", tone: "default" },
        { label: "财务入账", status: "待处理", owner: "财务部", tone: "default" },
        { label: "付款完成", status: "未完成", owner: "系统", tone: "danger" }
      ],
      executionAllocations: [],
      executionCoverages: [],
      evidenceFiles: [],
      approvalTimeline: [],
      availableActions: [],
      availableActionKeys: [],
      reviewApprovalContext: null,
      executionContext: null,
      lifecycleKind: "formal_record",
      ledgerView: "formal_ledger",
      nextStep: "出纳付款登记",
      currentOwner: "出纳/财务",
      returnReason: "-",
      lifecycleUpdatedAt: null,
      blockedReasons: [],
      primaryAction: null,
      disabledReasons: [],
      traceRules: [
        "付款申请只能来自已生效结算",
        "审批通过进入已批待付",
        "审批通过不等于实际付款完成",
        "实付登记必须上传付款凭证并写入审计日志"
      ],
      executionBlockMessage:
        "付款审批已通过，但尚未登记实际付款；必须由出纳/财务登记实付金额并上传付款凭证后，才能进入财务入账与付款完成。",
      chainLinks: [
        { label: "关联结算", to: "/settlements/JS-2026-018" },
        { label: "付款凭证", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private async actorRoleKeys(actorUserId: string | undefined, projectId: string): Promise<RoleKey[]> {
    if (!actorUserId || !this.projectVisibility) {
      return [];
    }

    return this.projectVisibility.effectiveRoleKeys(actorUserId, projectId);
  }

  private async isActiveCurrentProjectFinanceStaff(
    actorUserId: string | undefined,
    projectId: string
  ): Promise<boolean> {
    if (!actorUserId) return false;

    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) return false;

    const [projectPositions, projectMembers] = await Promise.all([
      this.prisma.userPosition.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionId: true }
      }),
      this.prisma.projectMember.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionKey: true }
      })
    ]);
    if (projectMembers.some((member) => member.positionKey === "finance_staff")) {
      return true;
    }

    const positionIds = [
      ...new Set(projectPositions.map((position) => position.positionId))
    ];
    if (positionIds.length === 0) return false;
    const positions = await this.prisma.position.findMany({
      where: { id: { in: positionIds } },
      select: { key: true }
    });
    return positions.some((position) => position.key === "finance_staff");
  }

  private async canReviewCurrentApproval(
    businessType: string,
    businessId: string,
    projectId: string,
    roleKeys: RoleKey[],
    actorUserId?: string
  ): Promise<CurrentPaymentApprovalReview> {
    if (!actorUserId) {
      return emptyCurrentPaymentApprovalReview();
    }

    const approvalClient = (this.prisma as unknown as {
      approvalInstance?: {
        findMany(args: {
          where: {
            businessType: string;
            businessId: string;
            flowType: "payment.approve";
            status: "in_progress";
          };
          orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>;
          take: 2;
          select: {
            id: true;
            applicantUserId: true;
            frozenNodes: true;
            currentNodeIndex: true;
            updatedAt: true;
          };
        }): Promise<Array<{
          id: string;
          applicantUserId: string;
          frozenNodes: unknown;
          currentNodeIndex: number;
          updatedAt: Date;
        }>>;
      };
    }).approvalInstance;
    if (!approvalClient?.findMany) {
      return emptyCurrentPaymentApprovalReview();
    }

    const instances = await approvalClient.findMany({
      where: {
        businessType,
        businessId,
        flowType: "payment.approve",
        status: "in_progress"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      select: {
        id: true,
        applicantUserId: true,
        frozenNodes: true,
        currentNodeIndex: true,
        updatedAt: true
      }
    });

    if (instances.length !== 1) {
      return emptyCurrentPaymentApprovalReview();
    }
    const instance = instances[0];

    if (isOrdinaryPaymentParallelRound(instance.frozenNodes)) {
      if (!this.projectVisibility) return emptyCurrentPaymentApprovalReview();
      const actorRoleScopes = await this.projectVisibility.effectiveRoleScopesInTransaction(this.prisma, actorUserId, projectId);
      const activeDelegators = await Promise.all((await activeApprovalDelegatorIds(this.prisma, actorUserId)).map(async userId => {
        const roleScopes = await this.projectVisibility!.effectiveRoleScopesInTransaction(this.prisma, userId, projectId);
        return { userId, roleScopes, roleKeys: resolveEffectiveRoleKeys(roleScopes.globalRoleKeys, roleScopes.projectRoleKeys) };
      }));
      const nodes = instance.frozenNodes;
      const indexes = activeApprovalNodeIndexes(nodes, instance.currentNodeIndex);
      const duties = actorUserId === instance.applicantUserId ? [] : indexes.flatMap(index =>
        resolveOrdinaryPaymentDuty(nodes, index, { actorUserId, actorRoleKeys: roleKeys, actorRoleScopes }, true)
          ? [{ index, name: String(nodes[index].name) }] : []);
      const delegation = duties.length && instance.updatedAt instanceof Date
        ? { expectedApprovalInstanceId: instance.id, expectedApprovalUpdatedAt: instance.updatedAt.toISOString(), duties } : undefined;
      const delegationPrincipals = await loadOrdinaryPaymentDelegationPrincipals(this.prisma, nodes, actorUserId, projectId,
        id => this.projectVisibility!.effectiveRoleScopesInTransaction(this.prisma, id, projectId));
      let fallback: CurrentPaymentApprovalReview = { ...emptyCurrentPaymentApprovalReview(), delegation };
      for (const index of indexes) {
        const identity = resolveOrdinaryPaymentDuty(instance.frozenNodes, index, {
          actorUserId, actorRoleKeys: roleKeys, actorRoleScopes, activeDelegators, delegationPrincipals
        });
        if (!identity) continue;
        const approval = { id: instance.id, currentNodeIndex: index, updatedAt: instance.updatedAt, executionMode: "parallel" as const };
        try {
          assertOrdinaryApplicantCannotReview({ ...identity, actorUserId, actorRoleKeys: roleKeys, applicantUserId: instance.applicantUserId });
          return { approval, delegation, access: { canAct: true, canReview: true, requiresSelfReviewConfirmation: actorUserId === instance.applicantUserId } };
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
          fallback = { approval, delegation, access: { canAct: true, canReview: false, requiresSelfReviewConfirmation: false } };
        }
      }
      return fallback;
    }
    if (hasOrdinaryPaymentParallelMarker(instance.frozenNodes)) return emptyCurrentPaymentApprovalReview();
    const directOrAssignedAccess = approvalReviewAccessOnFrozenNode(
      instance.frozenNodes,
      instance.currentNodeIndex,
      roleKeys,
      actorUserId,
      instance.applicantUserId,
      false
    );
    if (directOrAssignedAccess.canAct) {
      return {
        access: directOrAssignedAccess,
        approval: {
          id: instance.id,
          currentNodeIndex: instance.currentNodeIndex,
          updatedAt: instance.updatedAt
        }
      };
    }

    const activeDelegators = await this.activeDelegatedApprovalIdentities(
      actorUserId,
      projectId
    );
    const delegatedAccess = approvalReviewAccessOnFrozenNode(
      instance.frozenNodes,
      instance.currentNodeIndex,
      roleKeys,
      actorUserId,
      instance.applicantUserId,
      activeDelegators
    );
    return {
      access: delegatedAccess,
      approval: delegatedAccess.canAct
        ? {
            id: instance.id,
            currentNodeIndex: instance.currentNodeIndex,
            updatedAt: instance.updatedAt
          }
        : null
    };
  }

  private async activeDelegatedApprovalIdentities(
    actorUserId: string,
    projectId: string
  ): Promise<Array<{ userId: string; roleKeys: RoleKey[] }>> {
    if (!this.projectVisibility) return [];

    const delegatorIds = await activeApprovalDelegatorIds(this.prisma, actorUserId, new Date());
    const identities: Array<{ userId: string; roleKeys: RoleKey[] }> = [];
    for (const delegatorId of delegatorIds) {
      const delegatorRoleKeys = await this.projectVisibility.effectiveRoleKeys(
        delegatorId,
        projectId
      );
      identities.push({ userId: delegatorId, roleKeys: delegatorRoleKeys });
    }
    return identities;
  }

  private paymentActions(
    status: string,
    roleKeys: RoleKey[],
    canRecordExecution: boolean,
    approvalReviewAccess: ApprovalReviewAccess,
    executionComplete: boolean,
    financeRecordedAmountCents: bigint,
    paidAmountCents: bigint,
    evidenceFiles: PaymentDetailReadModel["evidenceFiles"],
    parallelReview: boolean,
    canDelegateApproval: boolean,
    canWithdrawApproval: boolean
  ): DetailActionReadModel[] {
    const workflowActions = [
      detailAction({
        key: "download_approval_form",
        label: "下载审批单",
        kind: "normal",
        roleKeys,
        enabled: true
      }),
      detailAction({
        key: "withdraw_approval",
        label: "撤回审批",
        kind: "normal",
        roleKeys,
        requiredAction: "payment.create",
        enabled: status === "approval_pending" && canWithdrawApproval
      }),
      detailAction({
        key: "remind_approval",
        label: "催办审批",
        kind: "normal",
        roleKeys,
        requiredAction: "payment.create",
        enabled: status === "approval_pending"
      }),
      detailAction({
        key: "transfer_approval",
        label: "转审",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: approvalReviewAccess.canAct && !parallelReview,
        disabledReason: "当前用户不是当前审批节点处理人"
      }),
      detailAction({
        key: "delegate_approval",
        label: "委托",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: canDelegateApproval,
        disabledReason: "当前用户不是当前审批节点处理人"
      })
    ];

    if (status === "approval_pending") {
      return [
        detailAction({
          key: "review_approval",
          label: "处理付款审批",
          kind: "primary",
          roleKeys,
          requiredAction: "payment.approve",
          skipRoleCheck: true,
          enabled: approvalReviewAccess.canReview,
          requiresSelfReviewConfirmation:
            approvalReviewAccess.requiresSelfReviewConfirmation,
          disabledReason: approvalReviewAccess.canAct
            ? "申请人不能审批自己发起的业务"
            : "当前用户不是当前审批节点处理人"
        }),
        ...workflowActions
      ];
    }

    const actions: DetailActionReadModel[] = [...workflowActions];

    if (
      paidAmountCents > 0n &&
      ["approved_pending_payment", "partially_paid", "paid"].includes(status) &&
      roleKeys.some((role) => ["finance_staff", "finance_director", "comprehensive_director"].includes(role))
    ) {
      actions.push(
        detailAction({
          key: "record_refund",
          label: "登记实际退款",
          kind: "normal",
          roleKeys,
          skipRoleCheck: true,
          enabled: true
        }),
        detailAction({
          key: "correct_payment_execution",
          label: "更正已确认实付",
          kind: "normal",
          roleKeys,
          skipRoleCheck: true,
          enabled: true
        })
      );
    }

    if ((status === "approved_pending_payment" || status === "partially_paid") && !executionComplete) {
      actions.push(
        detailAction({
          key: "record_execution",
          label: "登记实际付款",
          kind: "primary",
          roleKeys,
          requiredAction: "payment.execution",
          enabled: !executionComplete && canRecordExecution,
          disabledReason: canRecordExecution
            ? "付款已完成"
            : "只有当前项目在职财务人员可以登记实际付款",
          requiresPassword: true,
          requiresFile: true
        })
      );
    }

    if (paidAmountCents > 0 || status === "paid" || status === "completed") {
      actions.push(
        detailAction({
          key: "record_finance",
          label: "财务入账",
          kind: "primary",
          roleKeys,
          requiredAction: "payment.finance_record",
          enabled: financeRecordedAmountCents < paidAmountCents,
          disabledReason: "财务已完成入账",
          requiresPassword: true
        })
      );
    }

    if (status === "paid" || status === "completed" || executionComplete) {
      actions.push(
        detailAction({
          key: "archive_pdf",
          label: "生成归档 PDF",
          kind: "normal",
          roleKeys,
          requiredAction: "payment.pdf_archive",
          enabled: paidAmountCents > 0 && financeRecordedAmountCents >= paidAmountCents,
          disabledReason: "财务入账未完成",
          requiresPassword: true
        })
      );
    }

    if (evidenceFiles.length) {
      actions.push(
        detailAction({
          key: "download_file",
          label: "下载付款凭证",
          kind: "normal",
          roleKeys,
          enabled: evidenceFiles.some((file) => file.canDownload),
          disabledReason: "暂无可下载付款凭证",
          requiresPassword: true
        })
      );
    }

    return actions;
  }

  private paymentSourceLabel(sourceType?: string | null) {
    if (sourceType === "contract_advance") {
      return "合同预付款";
    }

    if (sourceType === "contract_due") {
      return "合同累计结算付款";
    }

    if (sourceType === "signed_settlement") {
      return "已签结算最近确认一期";
    }

    return "未关联结算";
  }

  private paymentPdfPurposeLabel(templateKey: string) {
    if (templateKey === "payment_finance_archive") {
      return "付款财务归档 PDF";
    }

    return `付款归档 PDF（${templateKey}）`;
  }

  private allocationTypeLabel(allocationType: string) {
    if (allocationType === "contract_due_payment") {
      return "合同累计结算付款分摊";
    }

    if (allocationType === "advance_deduction") {
      return "预付款扣回";
    }

    return allocationType;
  }

  private approvalStatusView(status: string): { label: string; tone: CoreFlowTone } {
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      draft: { label: "草拟中", tone: "default" },
      approval_pending: { label: "审批中", tone: "primary" },
      approved_pending_payment: { label: "已通过", tone: "success" },
      partially_paid: { label: "已通过", tone: "success" },
      paid: { label: "已通过", tone: "success" },
      completed: { label: "已通过", tone: "success" },
      rejected: { label: "已退回", tone: "danger" },
      approval_rejected: { label: "已退回", tone: "danger" },
      abandoned: { label: "已结束", tone: "default" },
      returned_for_revision: { label: "退回待修改", tone: "warning" },
      withdrawn_for_revision: { label: "撤回待修改", tone: "warning" }
    };

    return views[status] ?? { label: "付款审批状态未读取", tone: "default" };
  }

  private executionStatusView(
    status: string,
    paidAmountCents: bigint,
    payableAmountCents: bigint
  ): { label: string; tone: CoreFlowTone; complete: boolean } {
    if (paidAmountCents >= payableAmountCents && payableAmountCents > 0n) {
      return { label: "已付款", tone: "success", complete: true };
    }

    if (paidAmountCents > 0n) {
      return { label: "部分付款", tone: "warning", complete: false };
    }

    if (status === "approved_pending_payment") {
      return { label: "已批待付", tone: "warning", complete: false };
    }

    return { label: "未付款", tone: "default", complete: false };
  }

  private nextActionLabel(status: string, complete: boolean): string {
    if (complete) {
      return "财务入账归档";
    }

    if (status === "approved_pending_payment") {
      return "出纳付款登记";
    }

    if (status === "partially_paid") {
      return "继续出纳付款登记";
    }

    return "等待付款审批";
  }

  private currentOwnerLabel(status: string, complete: boolean): string {
    if (complete) {
      return "财务部";
    }

    const labels: Record<string, string> = {
      draft: "项目经理",
      approval_pending: "审批节点处理人",
      approved_pending_payment: "出纳/财务",
      partially_paid: "出纳/财务",
      paid: "财务部",
      completed: "财务部",
      rejected: "项目经理",
      approval_rejected: "项目经理"
    };

    return labels[status] ?? "财务部";
  }

  private returnReason(status: string): string {
    return ["rejected", "approval_rejected"].includes(status)
      ? "审批退回，查看审批历史"
      : "-";
  }

  private stalledFor(value: Date): string {
    const days = Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
    return days === 0 ? "今天" : `${days}天`;
  }

  private settlementStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      approval_pending: "审批中",
      archive_pending: "待归档确认",
      effective: "已生效",
      partially_paid: "部分付款",
      paid: "已付款",
      voided: "已作废"
    };

    return labels[status] ?? status;
  }

  private approvalSteps(status: string): PaymentDetailReadModel["approvalSteps"] {
    const approvalComplete = ["approved_pending_payment", "partially_paid", "paid", "completed"].includes(status);

    return [
      { label: "付款申请", status: "已提交", owner: "经办人", tone: "success" },
      { label: "综合部主管审批", status: approvalComplete ? "已通过" : "待处理", owner: "综合部主管", tone: approvalComplete ? "success" : "primary" },
      { label: "项目经理审批", status: approvalComplete ? "已通过" : "待处理", owner: "项目经理", tone: approvalComplete ? "success" : "primary" },
      { label: "财务总监审批", status: approvalComplete ? "已通过" : "待处理", owner: "财务总监", tone: approvalComplete ? "success" : "default" },
      { label: "董事长/总经理或签", status: approvalComplete ? "已通过" : "待处理", owner: "董事长或总经理", tone: approvalComplete ? "success" : "default" },
      {
        label: "审批通过",
        status: approvalComplete ? "已批待付" : "未完成",
        owner: "系统",
        tone: approvalComplete ? "warning" : "default"
      }
    ];
  }

  private executionSteps(
    status: string,
    paidAmountCents: bigint,
    payableAmountCents: bigint,
    financeRecordedAmountCents = 0n
  ): PaymentDetailReadModel["executionSteps"] {
    const hasPayment = paidAmountCents > 0n;
    const complete = paidAmountCents >= payableAmountCents && payableAmountCents > 0n;
    const approved = status === "approved_pending_payment" || hasPayment || complete;
    const financeRecorded = hasPayment && financeRecordedAmountCents >= paidAmountCents;

    return [
      { label: "已批待付", status: approved ? "当前状态" : "未到达", owner: "财务部", tone: approved ? "warning" : "default" },
      { label: "出纳付款登记", status: hasPayment ? "已登记" : "待处理", owner: "出纳/财务", tone: hasPayment ? "success" : "primary" },
      { label: "付款凭证上传", status: hasPayment ? "已上传" : "待处理", owner: "出纳/财务", tone: hasPayment ? "success" : "default" },
      {
        label: "财务入账",
        status: financeRecorded ? "已入账" : complete ? "待处理" : "未开始",
        owner: "财务部",
        tone: financeRecorded ? "success" : complete ? "primary" : "default"
      },
      { label: "付款完成", status: complete ? "已完成" : "未完成", owner: "系统", tone: complete ? "success" : "danger" }
    ];
  }

  private executionBlockMessage(status: string, complete: boolean): string {
    if (complete) {
      return "实际付款已登记并上传付款凭证，后续由财务完成入账与归档。";
    }

    if (status === "partially_paid") {
      return "已登记部分实际付款；可在剩余审批金额内继续登记实付并上传付款凭证。";
    }

    if (status !== "approved_pending_payment") {
      return "付款申请仍在审批中；审批通过后才会进入已批待付，并开放出纳付款登记。";
    }

    return "付款审批已通过，但尚未登记实际付款；必须由出纳/财务登记实付金额并上传付款凭证后，才能进入财务入账与付款完成。";
  }

  private ratioLabel(ratioBps: number | null): string {
    if (ratioBps === null) {
      return "-";
    }

    return `${ratioBps / 100}%`;
  }

  /** 旧测试/合成客户端没有退款表时按无退款读取；真实 Prisma 客户端始终查询事实。 */
  private async readPaymentRefunds(paymentIds: string[]): Promise<Array<{
    id: string; paymentRequestId: string; paymentExecutionId: string; amountCents: bigint;
    receivedAt: Date; fundRegistrationId: string | null;
  }>> {
    if (!paymentIds.length) return [];
    const client = (this.prisma as unknown as {
      paymentExecutionRefund?: {
        findMany(args: {
          where: { paymentRequestId: { in: string[] } };
          select: { id: true; paymentRequestId: true; paymentExecutionId: true; amountCents: true; receivedAt: true; fundRegistrationId: true };
          orderBy?: Array<{ receivedAt: "asc" } | { id: "asc" }>;
        }): Promise<Array<{ id: string; paymentRequestId: string; paymentExecutionId: string; amountCents: bigint; receivedAt: Date; fundRegistrationId: string | null }>>;
      };
    }).paymentExecutionRefund;
    if (!client?.findMany) return [];
    return client.findMany({
      where: { paymentRequestId: { in: paymentIds } },
      select: { id: true, paymentRequestId: true, paymentExecutionId: true, amountCents: true, receivedAt: true, fundRegistrationId: true },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }]
    });
  }

  private async readPaymentCorrectionDeltas(paymentIds: string[]): Promise<Array<{ paymentRequestId: string; amountDeltaCents: bigint }>> {
    if (!paymentIds.length) return [];
    const client = (this.prisma as unknown as {
      paymentExecutionCorrection?: {
        findMany(args: {
          where: { paymentRequestId: { in: string[] }; status: string };
          select: { paymentRequestId: true; amountDeltaCents: true };
        }): Promise<Array<{ paymentRequestId: string; amountDeltaCents: bigint }>>;
      };
    }).paymentExecutionCorrection;
    if (!client?.findMany) return [];
    return client.findMany({ where: { paymentRequestId: { in: paymentIds }, status: "confirmed" }, select: { paymentRequestId: true, amountDeltaCents: true } });
  }

  private formatMoney(amountCents: bigint): string {
    return `¥${formatMoneyCentsAsYuan(dbMoneyToBigInt(amountCents, "付款金额"))}`;
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private positiveInteger(rawValue: string | number | undefined, fallback: number) {
    const parsed = typeof rawValue === "number" ? rawValue : Number(rawValue ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  }

  private paymentLedgerView(value: PaymentLedgerView | undefined): PaymentLedgerView {
    return value && ["formal_ledger", "my_drafts", "returned_for_revision", "ended"].includes(value)
      ? value
      : "formal_ledger";
  }

  private date(value: Date) {
    return value.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  }

  private dateOnly(value: Date | null) {
    return value ? value.toISOString().slice(0, 10) : null;
  }

  private paymentOccupancyBreakdown(
    paymentRequests: Array<{
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
      paidAmountCents: bigint;
      remainingWithdrawnCents?: bigint | null;
    }>
  ) {
    return paymentRequests.reduce(
      (totals, payment) => {
        if (payment.remainingWithdrawnCents != null) return totals;
        const paidAmountCents = payment.paidAmountCents > 0n ? payment.paidAmountCents : 0n;
        if (["approval_pending", "in_approval"].includes(payment.status)) {
          return {
            ...totals,
            approvalPendingCents:
              totals.approvalPendingCents +
              (payment.requestedAmountCents - paidAmountCents > 0n
                ? payment.requestedAmountCents - paidAmountCents
                : 0n)
          };
        }

        if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
          return {
            ...totals,
            approvedPendingCents:
              totals.approvedPendingCents +
              ((payment.approvedAmountCents ?? payment.requestedAmountCents) - paidAmountCents > 0n
                ? (payment.approvedAmountCents ?? payment.requestedAmountCents) - paidAmountCents
                : 0n)
          };
        }

        return totals;
      },
      {
        approvalPendingCents: 0n,
        approvedPendingCents: 0n
      }
    );
  }
}

const PAYMENT_LEDGER_COLUMNS: LedgerExcelColumn<Record<string, unknown>>[] = [
  { header: "付款编号", key: "paymentNo", width: 18, required: true },
  { header: "项目", key: "project", width: 24, required: true },
  { header: "关联合同", key: "contractNo", width: 30 },
  { header: "付款来源", key: "settlementNo", width: 20 },
  { header: "签约方（甲方）", key: "signingParty", width: 26, required: true },
  { header: "相对方（乙方）", key: "counterparty", width: 26, required: true },
  {
    header: "申请金额（元）",
    key: "requestedAmountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    align: "right",
    total: "sum",
    required: true
  },
  {
    header: "已付金额（元）",
    key: "paidAmountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    align: "right",
    total: "sum"
  },
  { header: "合同分类", key: "contractRelationshipLabel", width: 16 },
  { header: "审批状态", key: "approvalStatus", width: 14 },
  { header: "实付状态", key: "paymentStatus", width: 14 },
  { header: "当前处理人", key: "pendingOwner", width: 14 },
  { header: "下一步动作", key: "nextAction", width: 20 },
  { header: "更新时间", key: "updatedAtIso", width: 16, kind: "date", numFmt: LEDGER_DATE_FORMAT }
];

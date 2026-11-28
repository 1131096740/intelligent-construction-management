import { isConfirmedTextAgreementContract, PAYMENT_TEXT_AGREEMENT_BASIS, readTextAgreementContractLimit, readTextPaymentAgreement } from "./payment-text-agreement";
import { PaymentApprovalNotificationService } from "./payment-approval-notification.service";
import { currentPublicCashCustodian } from "../fund-account/public-cash-custodian";
import { sensitiveBusinessReadAllowed } from "../auth/sensitive-business-read";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { registeredPaymentInstalled } from "../database/registered-payment-catalog";
import { confirmRegisteredContractHistory, lockRegisteredContractHistoryRevision, registeredContractHistoryBasis } from "./registered-payment-contract-history";
import { currentRegisteredPaymentApproval } from "./registered-payment-approval";
import { registeredOriginalPaymentResults, resolveRegisteredExistingSource } from "./registered-payment-existing-source";
import { readRegisteredCompanyOwnedSources } from "../fund-account/registered-company-owned-fund-source";
import { appendRegisteredFunding, appendRegisteredIntercompany, assertRegisteredPaymentActor, enforceRegisteredPaymentAdvanceConstraints, prepareRegisteredFunding, readRegisteredProjectAdvanceStatus, registeredPaymentFingerprint } from "./registered-payment-funding";
import { RecordRegisteredPaymentExecutionDto } from "./dto/record-registered-payment-execution.dto";
import { type WithdrawPaymentRemainderDto } from "./dto/withdraw-payment-remainder.dto";
import { assertFrozenCompanyIdentity } from "../company-entity/frozen-company-identity";
import { chinaDateOnly, requiredPastChinaDate } from "@jiangkong/shared-domain";
import {requireContractBankEvent,claimContractBankEvent} from "../contract-ledger/contract-bank-event";
import { contractProxyPaid, contractProxyPaidForContract } from "../contract-ledger/contract-proxy-capacity";
import { createHash, randomUUID } from "node:crypto";
import { assertProjectApprovalNodesConfigured } from "../approval/project-approval-configuration";
import { BusinessEntryTransactionService } from "../business-entry-definition/business-entry-transaction.service";
import { paymentApprovalAmountEntryValues } from "./payment-approval-amount-business-entry-definition";
import { PAYMENT_FINANCE_ENTRY_DEFINITION } from "./payment-business-entry-definition";
import { PAYMENT_REQUEST_ENTRY_DEFINITION, paymentRequestEntryValues } from "./payment-request-business-entry-definition";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional
} from "@nestjs/common";
import { Prisma, type PaymentRequest } from "@prisma/client";
import {
  approvalElapsedHours,
  canPerform,
  canCreatePaymentFromSettlementStatus,
  canRemindApproval,
  directPaymentAmountNature,
  isContractSettlementMode,
  resolveEffectiveRoleKeys,
  SettlementStatus,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import {
  resolveApprovalReviewIdentity,
  assertActiveApprovalRecipient
} from "../approval/approval-review-identity";
import { snapshotApprovalSignature , withApprovalIdentity } from "../approval/approval-signature-snapshot";
import { queueApprovedRegisteredPaymentNotifications, RegisteredPaymentNotificationService } from "./registered-payment-notification.service";
import { currentRegisteredPaymentDomain } from "./registered-payment-domain";
import {
  lockApprovalReviewRow,
  supportsApprovalReviewLock
} from "../approval/approval-review-lock";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { PaymentExecutionSharedAllocationService } from "../fund-execution/payment-execution-shared-allocation.service";
import { fundExecutionSelectionRefFingerprint } from "../fund-execution/fund-execution-selection-ref.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { ContractTakeoverBalanceService } from "../contract-takeover/contract-takeover-balance.service";
import { assertTakeoverContinuationAllowed } from "../contract-takeover/contract-takeover-handover";
import {
  isPostgresSerializationFailure,
  postgresSqlState
} from "../project/project-operating-constraint";
import {
  missingOperatingSourceReplayService,
  OperatingSourceReplayService,
  type OperatingSourceAppendPort
} from "../operating-ledger/operating-source-replay.service";
import { PAYMENT_EXECUTION_SOURCE_TYPE } from "./payment-operating-source.adapter";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  mapBigIntMoneyFieldsToApi,
  moneyCentsToApi,
  parseMoneyCents,
  parseMoneyCentsInput,
  sumDbMoneyToBigInt
} from "../money/decimal-money";
import { renderSimplePdf } from "../pdf/simple-pdf";
import type { AssignPaymentApprovalDto, DelegatePaymentApprovalDto } from "./dto/assign-payment-approval.dto";
import type { AbandonPaymentRequestDto } from "./dto/abandon-payment-request.dto";
import type { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import type { GeneratePaymentPdfArchiveDto } from "./dto/generate-payment-pdf-archive.dto";
import type { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import type { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import type { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import type { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import type { RevisePaymentRequestDto } from "./dto/revise-payment-request.dto";
import { hasPaymentRevisionBasis, paymentRevisionAction } from "./payment-revision-basis";
import { inspectPaymentApprovalHistory } from "./payment-approval-cutover";
import { hasOrdinaryPaymentParallelMarker, isOrdinaryPaymentParallelRound, loadOrdinaryPaymentDelegationPrincipals, ordinaryPaymentParallelNodes, resolveOrdinaryPaymentDuty } from "./ordinary-payment-parallel";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  type ContractTakeoverBalanceRow,
  toHistoricalContractPaymentBalance
} from "./contract-takeover-balance";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";
import { loadSettlementPaymentConfirmationFacts } from "./settlement-confirmation-facts";
import {
  loadSignedSettlementPaymentBasis,
  SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND,
  type SignedSettlementPaymentBasis
} from "./signed-settlement-payment-capacity";
import {
  allocateContractDuePaymentExecution,
  buildContractPaymentApplicationPreview,
  calculateContractAdvancePaymentCapacityBigInt,
  calculateContractDuePaymentCapacityBigInt,
  calculateSettlementPaymentCapacityBigInt,
  CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES,
  SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
  sumMoneyCents
} from "./settlement-payment-capacity";
import {
  type PayerAttestationAuthorization
} from "../payable-registry/payer-attestation.domain";

const PAYMENT_POST_MONEY_FIELDS = [
  "requestedAmountCents",
  "approvedAmountCents",
  "paidAmountCents",
  "remainingWithdrawnCents",
  "amountCents",
  "fixedAmountCents",
  "sourcePayableAmountCents",
  "payableAmountCents",
  "contractAmountCents"
] as const;

const SETTLEMENT_PAYMENT_CONTRACT_TYPES = new Set([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
]);

function paymentPostResponseToApi<T>(value: T) {
  return mapBigIntMoneyFieldsToApi(value, PAYMENT_POST_MONEY_FIELDS);
}

interface PaymentApprovalAssignment {
  kind: "transfer" | "delegate";
  fromUserId: string;
  fromRoleKey: RoleKey;
  toUserId: string;
}

interface PaymentApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
  assignments?: PaymentApprovalAssignment[];
  candidateUserIds?: string[];
  candidateUserIdsByRole?: Partial<Record<RoleKey, string[]>>;
  selectedUserId?: string;
}

interface PaymentExecutionLockRow {
  companyDirectoryIsActive: boolean;
  contractVersionStatus: string;
  contractProjectId: string;
  companyEntityVersionId: string | null;
  id: string;
  code: string;
  projectId: string;
  contractId: string;
  contractTypeKey?: string;
  contractVersionId: string;
  paymentTermsVersionId?: string;
  paymentTermsStageId?: string | null;
  contractDueBasis?: string | null;
  settlementId: string | null;
  signedSettlementId: string | null;
  sourceType?: string;
  updatedAt: Date;
  paymentSubjectType: string;
  signingSubjectType: string;
  companyEntityIdSnapshot: string | null;
  companyEntityNameSnapshot: string | null;
  companyEntityCreditCodeSnapshot: string | null;
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents: bigint | null;
  paidAmountCents: bigint;
  remainingWithdrawnCents?: bigint | null;
}

type RegisteredPaymentCoordinates = {
  idempotencyKey: string;
  paymentId: string;
  actorUserId: string;
  amountCents: bigint;
  paidAt: Date;
};

interface PaymentExecutionFactRow {
  id: string;
  idempotencyKey: string;
  paymentRequestId: string;
  settlementId: string | null;
  paymentSubjectType: string;
  companyEntityIdSnapshot: string | null;
  companyEntityNameSnapshot: string | null;
  companyEntityCreditCodeSnapshot: string | null;
  amountCents: bigint;
  paidAt: Date;
  executedByUserId: string;
  voucherFileId: string | null;
  payerAttestationFingerprint?: string | null;
}

type NormalizedPayerAttestation = Readonly<{
  bankAccountReference: string;
  authorization: PayerAttestationAuthorization | null;
  fingerprint: string;
}>;

type WagePaymentExecutionResponse = Readonly<{
  id?: never;
  amountCents: string;
  paidAt: Date;
  paymentSubjectType: string;
}>;

function wagePaymentExecutionResponseToApi(
  value: PaymentExecutionFactRow
): WagePaymentExecutionResponse {
  const response = mapBigIntMoneyFieldsToApi(value, ["amountCents"]) as Record<
    string,
    unknown
  >;
  return {
    amountCents: String(response.amountCents),
    paidAt: response.paidAt as Date,
    paymentSubjectType: String(response.paymentSubjectType)
  };
}

type NormalizedWagePayableBinding = Readonly<{
  payableRef: string;
  amountCents: bigint;
}>;

type NormalizedCreatePaymentRequest = Omit<CreatePaymentRequestDto, "requestedAmountCents"> & {
  requestedAmountCents: bigint;
};

type PaymentRevision = { draft: PaymentRequest; previousRoundId: string; parallel: boolean };

type AuditWriteClient = Pick<Prisma.TransactionClient, "auditLog">;

function positiveMoneyCents(value: string, message: string): bigint {
  const cents = parseMoneyCentsInput(value, "金额", message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function normalizeWagePayableBindings(
  bindings: RecordPaymentExecutionDto["wagePayableBindings"] | undefined
): readonly NormalizedWagePayableBinding[] {
  if (!bindings?.length) return [];
  const seen = new Set<string>();
  return bindings.map((binding) => {
    const payableRef = binding.payableRef?.trim();
    if (!payableRef || seen.has(payableRef)) {
      throw new BadRequestException("工资债权关联必须引用不重复的应付引用");
    }
    seen.add(payableRef);
    return {
      payableRef,
      amountCents: positiveMoneyCents(
        binding.amountCents,
        "工资债权关联金额必须大于 0"
      )
    };
  });
}

function normalizePayerAttestation(
  value: RecordPaymentExecutionDto["payerAttestation"] | undefined
): NormalizedPayerAttestation | null {
  if (!value) return null;
  const bankAccountReference = value.bankAccountReference?.trim();
  if (!bankAccountReference) throw new BadRequestException("服务端银行账户核验引用不能为空");
  const authorization = value.proxyAuthorization
    ? {
        reason: value.proxyAuthorization.reason?.trim() ?? "",
        evidenceFileId: value.proxyAuthorization.evidenceFileId?.trim() ?? "",
        reauthorizationReference:
          value.proxyAuthorization.reauthorizationReference?.trim() ?? "",
        reauthorizedByUserId:
          value.proxyAuthorization.reauthorizedByUserId?.trim() ?? "",
        reauthorizedAt: new Date(value.proxyAuthorization.reauthorizedAt)
      }
    : null;
  if (
    authorization &&
    (!authorization.reason ||
      !authorization.evidenceFileId ||
      !authorization.reauthorizationReference ||
      !authorization.reauthorizedByUserId ||
      Number.isNaN(authorization.reauthorizedAt.getTime()))
  ) {
    throw new BadRequestException("跨主体付款授权事实不完整");
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        bankAccountReference,
        authorization: authorization
          ? {
              reason: authorization.reason,
              evidenceFileId: authorization.evidenceFileId,
              reauthorizationReference: authorization.reauthorizationReference,
              reauthorizedByUserId: authorization.reauthorizedByUserId,
              reauthorizedAt: authorization.reauthorizedAt.toISOString()
            }
          : null
      })
    )
    .digest("hex");
  return {
    bankAccountReference,
    authorization,
    fingerprint
  };
}

function optionalTrimmedText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function paymentSubjectForSigningSubject(
  requestedSubject: string | undefined,
  signingSubjectType: string | undefined
): "our_company" | "affiliate" {
  const expectedSubject = signingSubjectType === "affiliate" ? "affiliate" : "our_company";
  if (signingSubjectType !== undefined && !["affiliate", "our_company"].includes(signingSubjectType)) {
    throw new BadRequestException("合同签约主体不正确，不能发起付款申请");
  }
  if (requestedSubject !== undefined && requestedSubject !== expectedSubject) {
    throw new BadRequestException("付款主体必须与合同签约主体一致");
  }
  return expectedSubject;
}

const PAYMENT_APPROVAL_NODES = [
  {
    name: "综合部主管",
    mode: "any",
    roleKeys: ["comprehensive_director"]
  },
  {
    name: "项目经理",
    mode: "any",
    roleKeys: ["project_manager"]
  },
  {
    name: "财务",
    mode: "any",
    roleKeys: ["finance_director"]
  },
  {
    name: "合同部主管",
    mode: "any",
    roleKeys: ["contract_director"]
  },
  {
    name: "董事长/总经理",
    mode: "any",
    roleKeys: ["chairman", "general_manager"]
  }
] satisfies PaymentApprovalNode[];
const PROJECT_CASH_POOL_PAYMENT_STATUSES = [
  "approval_pending",
  "in_approval",
  "approved_pending_payment",
  "partially_paid",
  "paid"
] as const;

@Injectable()
export class PaymentRequestService {
  @Inject(BusinessEntryTransactionService)
  private readonly businessEntry!: BusinessEntryTransactionService;
  constructor(
    private readonly amount: PaymentAmountService,
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly delegations?: ApprovalDelegationService,
    @Optional()
    private readonly approvalForms?: ApprovalFormService,
    private readonly projectFunding?: ProjectFundingAvailabilityService,
    @Optional()
    private readonly takeoverBalances?: ContractTakeoverBalanceService,
    @Inject(OperatingSourceReplayService)
    private readonly operatingSources: OperatingSourceAppendPort =
      missingOperatingSourceReplayService(),
    @Optional()
    private readonly sharedAllocations?: PaymentExecutionSharedAllocationService,
    @Optional()
    private readonly registeredNotifications?: RegisteredPaymentNotificationService,
    @Optional() private readonly approvalNotifications?: PaymentApprovalNotificationService,
    @Optional() private readonly writeFreeze: OperationalWriteFreezeService = new OperationalWriteFreezeService()
  ) {}

  assertSettlementEffective(status: SettlementStatus): void {
    if (!canCreatePaymentFromSettlementStatus(status)) {
      throw new Error("当前结算尚未归档生效，不能发起付款申请");
    }
  }

  assertRequestAllowed(
    status: SettlementStatus,
    capacity: PaymentCapacity,
    requestedAmountCents: bigint
  ): void {
    this.assertSettlementEffective(status);
    this.amount.assertCanRequest(capacity, requestedAmountCents);
  }

  private async assertHistoricalTakeoverPaymentReady(
    tx: Prisma.TransactionClient,
    input: {
      contractId: string;
      contractVersionId: string;
      sourceType: "settlement" | "signed_settlement" | "contract_advance" | "contract_due";
      actorUserId?: string;
      actionLabel?: string;
    }
  ) {
    const actionLabel = input.actionLabel ?? "发起付款申请";
    const takeoverClient = (tx as unknown as {
      contractTakeover?: {
        findUnique?: (args: {
          where: { contractVersionId: string };
          select: {
            id: true;
            takeoverStatus: true;
            takeoverLevel: true;
            historicalBalanceConfirmedAt: true;
          };
        }) => Promise<{
          id: string;
          takeoverStatus: string;
          takeoverLevel?: string | null;
          historicalBalanceConfirmedAt: Date | null;
        } | null>;
      };
    }).contractTakeover;
    const takeover =
      typeof takeoverClient?.findUnique === "function"
        ? await takeoverClient.findUnique({
            where: { contractVersionId: input.contractVersionId },
            select: {
              id: true,
              takeoverStatus: true,
              takeoverLevel: true,
              historicalBalanceConfirmedAt: true
            }
          })
        : null;

    if (takeover) {
      if (takeover.takeoverStatus !== "confirmed") {
        await this.recordHistoricalTakeoverPaymentBlock(tx, {
          actorUserId: input.actorUserId,
          businessType: "contract_takeover",
          businessId: takeover.id,
          contractId: input.contractId,
          contractVersionId: input.contractVersionId,
          sourceType: input.sourceType,
          reason: "takeover_not_confirmed",
          takeoverStatus: takeover.takeoverStatus
        });
        throw new BadRequestException(`历史合同接管尚未主管确认，不能${actionLabel}`);
      }
      if (!takeover.historicalBalanceConfirmedAt) {
        await this.recordHistoricalTakeoverPaymentBlock(tx, {
          actorUserId: input.actorUserId,
          businessType: "contract_takeover",
          businessId: takeover.id,
          contractId: input.contractId,
          contractVersionId: input.contractVersionId,
          sourceType: input.sourceType,
          reason: "historical_balance_not_confirmed",
          takeoverStatus: takeover.takeoverStatus
        });
        throw new BadRequestException(`历史余额尚未确认，不能${actionLabel}`);
      }
      // 旧等级不再作为业务门槛；无等级/C 级改由接管分工登记决定今后由谁办理。
      try {
        await assertTakeoverContinuationAllowed(tx, takeover, actionLabel);
      } catch (error) {
        await this.recordHistoricalTakeoverPaymentBlock(tx, {
          actorUserId: input.actorUserId,
          businessType: "contract_takeover",
          businessId: takeover.id,
          contractId: input.contractId,
          contractVersionId: input.contractVersionId,
          sourceType: input.sourceType,
          reason: "handover_required",
          takeoverStatus: takeover.takeoverStatus
        });
        throw error;
      }
      if (this.takeoverBalances) {
        try {
          await this.takeoverBalances.assertNoAbnormalOverpayForContract(
            tx,
            input.contractId,
            actionLabel
          );
        } catch (error) {
          await this.recordHistoricalTakeoverPaymentBlock(tx, {
            actorUserId: input.actorUserId,
            businessType: "contract_takeover",
            businessId: takeover.id,
            contractId: input.contractId,
            contractVersionId: input.contractVersionId,
            sourceType: input.sourceType,
            reason: "abnormal_overpay_unresolved",
            takeoverStatus: takeover.takeoverStatus
          });
          throw error;
        }
      }
      return;
    }

    const contractClient = (tx as unknown as {
      contract?: {
        findUnique(args: {
          where: { id: string };
          select: { source: true };
        }): Promise<{ source?: string | null } | null>;
      };
    }).contract;
    const contract = contractClient
      ? await contractClient.findUnique({
          where: { id: input.contractId },
          select: { source: true }
        })
      : null;
    if (contract?.source === "historical_takeover") {
      await this.recordHistoricalTakeoverPaymentBlock(tx, {
        actorUserId: input.actorUserId,
        businessType: "contract",
        businessId: input.contractId,
        contractId: input.contractId,
        contractVersionId: input.contractVersionId,
        sourceType: input.sourceType,
        reason: "takeover_missing"
      });
      throw new BadRequestException(`历史合同接管尚未主管确认，不能${actionLabel}`);
    }
  }

  private async recordHistoricalTakeoverPaymentBlock(
    tx: Prisma.TransactionClient,
    input: {
      actorUserId?: string;
      businessType: "contract_takeover" | "contract";
      businessId: string;
      contractId: string;
      contractVersionId: string;
      sourceType: string;
      reason: string;
      takeoverStatus?: string;
    }
  ) {
    if (!input.actorUserId) {
      return;
    }

    const auditClient = this.auditClientOutsideFailedTransaction(tx);
    await this.audit.record(auditClient, {
      actorUserId: input.actorUserId,
      action: "payment.contract_takeover.blocked",
      businessType: input.businessType,
      businessId: input.businessId,
      metadata: {
        contractId: input.contractId,
        contractVersionId: input.contractVersionId,
        sourceType: input.sourceType,
        reason: input.reason,
        takeoverStatus: input.takeoverStatus ?? null
      }
    });
  }

  private auditClientOutsideFailedTransaction(tx: Prisma.TransactionClient): AuditWriteClient {
    const rootClient = this.prisma as unknown as AuditWriteClient | undefined;
    return rootClient?.auditLog ? rootClient : tx;
  }

  private async recordPaymentRequestCreated(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      code: string;
      projectId: string;
      settlementId: string | null;
      sourceType?: string | null;
      contractId: string;
      contractVersionId?: string | null;
      paymentTermsVersionId?: string | null;
      requestedAmountCents: bigint;
    },
    actorUserId?: string
  ) {
    if (!actorUserId) {
      return;
    }
    const auditClient = tx as unknown as AuditWriteClient;
    if (!auditClient.auditLog) {
      return;
    }

    await this.audit.record(auditClient, {
      actorUserId,
      action: "payment.request.create",
      businessType: "payment_request",
      businessId: payment.id,
      metadata: {
        projectId: payment.projectId,
        settlementId: payment.settlementId,
        sourceType: payment.sourceType ?? "settlement",
        contractId: payment.contractId,
        contractVersionId: payment.contractVersionId ?? null,
        paymentTermsVersionId: payment.paymentTermsVersionId ?? null,
        code: payment.code,
        requestedAmountCents: moneyCentsToApi(payment.requestedAmountCents)
      }
    });
  }

  private async confirmedHistoricalBalanceForContract(
    tx: Prisma.TransactionClient,
    contractId: string
  ) {
    const takeoverClient = (tx as unknown as {
      contractTakeover?: {
        findFirst?: (args: {
          where: {
            contractId: string;
            takeoverStatus: string;
            historicalBalanceConfirmedAt: { not: null };
          };
          select: typeof CONTRACT_TAKEOVER_BALANCE_SELECT;
        }) => Promise<ContractTakeoverBalanceRow | null>;
      };
    }).contractTakeover;

    if (!takeoverClient?.findFirst) {
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

  async create(input: CreatePaymentRequestDto, applicantUserId?: string) {
    if (!this.prisma) {
      throw new Error("付款申请创建服务暂不可用，请稍后重试或联系管理员");
    }

    const normalizedInput: NormalizedCreatePaymentRequest = {
      ...input,
      requestedAmountCents: positiveMoneyCents(input.requestedAmountCents, "付款申请金额必须为大于 0 的整数分")
    };

    const payment = await this.prisma.$transaction(tx =>
      this.submitPaymentRequest(tx, normalizedInput, applicantUserId));
    await this.approvalNotifications?.afterCommit(payment.id);
    return paymentPostResponseToApi(payment);
  }

  async reviseAndSubmit(paymentId: string, actorUserId: string, input: RevisePaymentRequestDto) {
    if (!this.prisma) throw new BadRequestException("付款申请重提服务暂不可用");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime())) throw new BadRequestException("付款申请更新时间不正确，请刷新后重试");
    const requestedAmountCents = positiveMoneyCents(input.requestedAmountCents, "付款申请金额必须为大于 0 的整数分");
    const payment = await this.prisma.$transaction(async tx => {
      // Match review and execution: lock the payment before the contract capacity path.
      const matches = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "PaymentRequest" WHERE id = ${paymentId} OR code = ${paymentId} ORDER BY id FOR UPDATE
      `;
      if (matches.length !== 1) throw new ConflictException("未找到唯一的退回待修改付款申请");
      const draft = await tx.paymentRequest.findUnique({ where: { id: matches[0].id } });
      if (!draft || draft.status !== "draft" ||
          draft.updatedAt.getTime() !== expectedUpdatedAt.getTime() || !hasPaymentRevisionBasis(draft)) {
        throw new ConflictException("付款申请状态、版本或原付款依据已变化，请刷新后重试");
      }
      await tx.$queryRaw`SELECT id FROM "ApprovalInstance" WHERE "businessType" = 'payment_request'
        AND "businessId" = ${draft.id} AND "flowType" = 'payment.approve' FOR UPDATE`;
      const previous = await tx.approvalInstance.findFirst({
        where: { businessType: "payment_request", businessId: draft.id, flowType: "payment.approve" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      const revisionAction = paymentRevisionAction(previous);
      if (!previous || !revisionAction ||
          await tx.approvalInstance.count({ where: {
            businessType: "payment_request", businessId: draft.id, flowType: "payment.approve", status: "in_progress"
          } }) !== 0 ||
          !await tx.approvalActionLog.findFirst({
            where: {
              approvalInstanceId: previous.id, action: revisionAction,
              ...(revisionAction === "withdraw" ? { actorUserId: previous.applicantUserId } : {})
            },
            select: { id: true }
          })) {
        throw new ConflictException("付款申请缺少退回或撤回待修改记录，请刷新后重试");
      }
      if (previous.applicantUserId !== actorUserId) throw new ForbiddenException("只有原申请人可以修改并重提付款申请");
      if (await tx.paymentExecution.findFirst({ where: { paymentRequestId: draft.id }, select: { id: true } })) {
        throw new ConflictException("付款申请已有实付记录，不能作为草稿重提");
      }
      const holds = await this.financingUsageTotals(tx, draft.id);
      if (holds.occupied > 0n || holds.used > 0n) {
        throw new ConflictException("原付款申请仍有垫资额度占用或实付，请核对后重提");
      }

      return this.submitPaymentRequest(tx, {
        sourceType: draft.sourceType as CreatePaymentRequestDto["sourceType"],
        code: draft.code, requestedAmountCents,
        paymentSubjectType: draft.paymentSubjectType as CreatePaymentRequestDto["paymentSubjectType"],
        settlementId: draft.settlementId ?? undefined,
        signedSettlementId: draft.signedSettlementId ?? undefined,
        contractVersionId: draft.contractVersionId,
        paymentTermsVersionId: draft.paymentTermsVersionId,
        paymentTermsStageId: draft.paymentTermsStageId ?? undefined,
        paymentMatter: input.paymentMatter ?? draft.paymentMatter ?? undefined,
        amountCalculationExplanation: input.amountCalculationExplanation ?? draft.amountCalculationExplanation ?? undefined
      }, actorUserId, { draft, previousRoundId: previous.id, parallel: isOrdinaryPaymentParallelRound(previous.frozenNodes) });
    });
    await this.approvalNotifications?.afterCommit(payment.id);
    return paymentPostResponseToApi(payment);
  }

  async withdrawRemainder(paymentId: string, actorUserId: string, input: WithdrawPaymentRemainderDto) {
    if (!this.prisma) throw new ConflictException("付款余款调整服务暂不可用");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    const requestedAmountCents = parseMoneyCentsInput(input.requestedAmountCents, "调整后的待付金额", "调整后的待付金额格式不正确");
    const reason = input.reason.trim();
    const code = input.code?.trim();
    if (Number.isNaN(expectedUpdatedAt.getTime()) || requestedAmountCents < 0n || !reason || (requestedAmountCents > 0n && !code)) {
      throw new BadRequestException("请填写有效的申请版本、调整原因和新付款单号");
    }
    const result = await this.prisma.$transaction(async tx => {
      const payment = await this.lockPaymentRequestForUpdate(tx, paymentId);
      if (!payment || payment.sourceType !== "signed_settlement" || payment.paymentSubjectType !== "our_company" ||
          payment.remainingWithdrawnCents != null || payment.updatedAt.getTime() !== expectedUpdatedAt.getTime() ||
          !["approved_pending_payment", "partially_paid"].includes(payment.status) || payment.approvedAmountCents === null) {
        throw new ConflictException("当前已签结算付款的状态或版本已变化，请刷新后重试");
      }
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
      if (!actor?.isActive || !(await this.loadActorRoleKeys(tx, actorUserId, payment.projectId)).includes("comprehensive_director")) {
        throw new ForbiddenException("只有本项目有权的综合部主管可以调整付款余款");
      }
      const round = await currentRegisteredPaymentApproval(tx, payment.id);
      if (!round) throw new ConflictException("付款申请缺少有效的原批准轮次，请先核对");
      const withdrawnCents = payment.approvedAmountCents - payment.paidAmountCents;
      if (withdrawnCents <= 0n || requestedAmountCents >= withdrawnCents) {
        throw new BadRequestException("调整后的待付金额必须少于原剩余待付金额");
      }
      const origin = await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { remainingWithdrawnCents: withdrawnCents }
      });
      const revised = await this.createReducedRemainderRequest(tx, origin, actorUserId, requestedAmountCents, code);
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.request.withdraw_remainder",
        businessType: "payment_request",
        businessId: origin.id,
        metadata: {
          previousApprovalInstanceId: round.id,
          approvedCents: moneyCentsToApi(payment.approvedAmountCents),
          paidCents: moneyCentsToApi(payment.paidAmountCents),
          withdrawnCents: moneyCentsToApi(withdrawnCents),
          revisedPaymentId: revised?.id ?? null,
          requestedAmountCents: moneyCentsToApi(requestedAmountCents),
          reason
        }
      });
      return { origin, revised };
    });
    if (result.revised) await this.approvalNotifications?.afterCommit(result.revised.id);
    return { origin: paymentPostResponseToApi(result.origin), revised: result.revised ? paymentPostResponseToApi(result.revised) : null };
  }

  private async createReducedRemainderRequest(
    tx: Prisma.TransactionClient,
    origin: PaymentRequest,
    actorUserId: string,
    requestedAmountCents: bigint,
    code?: string
  ) {
    if (requestedAmountCents === 0n) return null;
    await this.lockContractPaymentCapacityRows(tx, origin.contractId);
    const basis = await loadSignedSettlementPaymentBasis(tx, origin.contractId, { lock: true });
    return this.submitPaymentRequest(tx, {
      sourceType: "signed_settlement",
      signedSettlementId: basis.latestConfirmed.id,
      code: code!,
      requestedAmountCents,
      paymentSubjectType: origin.paymentSubjectType as CreatePaymentRequestDto["paymentSubjectType"],
      paymentMatter: origin.paymentMatter ?? undefined,
      amountCalculationExplanation: origin.amountCalculationExplanation ?? undefined
    }, actorUserId);
  }

  private persistPaymentSubmission(
    tx: Prisma.TransactionClient,
    data: Prisma.PaymentRequestUncheckedCreateInput,
    revision?: PaymentRevision
  ) {
    if (!revision) return tx.paymentRequest.create({ data });
    const { draft } = revision;
    if (data.projectId !== draft.projectId || data.contractId !== draft.contractId ||
        data.contractVersionId !== draft.contractVersionId || data.paymentTermsVersionId !== draft.paymentTermsVersionId ||
        (data.paymentTermsStageId ?? null) !== draft.paymentTermsStageId || data.paymentSubjectType !== draft.paymentSubjectType ||
        (data.settlementId ?? null) !== draft.settlementId || (data.signedSettlementId ?? null) !== draft.signedSettlementId ||
        data.sourceType !== draft.sourceType || (data.contractDueBasis ?? null) !== (draft.contractDueBasis ?? null)) {
      throw new ConflictException("原合同、结算、付款阶段或付款主体已变化，请核对原付款依据");
    }
    return tx.paymentRequest.update({
      where: { id: draft.id },
      data: {
        status: "approval_pending",
        requestedAmountCents: data.requestedAmountCents,
        paymentMatter: data.paymentMatter,
        amountCalculationExplanation: data.amountCalculationExplanation,
        signedSettlementConfirmationNo: data.signedSettlementConfirmationNo,
        signedSettlementConfirmedYuan: data.signedSettlementConfirmedYuan,
        signedSettlementContractConfirmedYuan: data.signedSettlementContractConfirmedYuan,
        signedSettlementOccupiedCents: data.signedSettlementOccupiedCents,
        signedSettlementBasisAt: data.signedSettlementBasisAt
      }
    });
  }

  private async finishPaymentSubmission(
    tx: Prisma.TransactionClient, payment: PaymentRequest, applicantUserId?: string, revision?: PaymentRevision
  ) {
    if (!applicantUserId) return payment;
    await assertProjectApprovalNodesConfigured(tx, payment.projectId, PAYMENT_APPROVAL_NODES, applicantUserId);
    const round = await tx.approvalInstance.create({
      data: {
        flowType: "payment.approve",
        businessType: "payment_request",
        businessId: payment.id,
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: (revision?.parallel ? ordinaryPaymentParallelNodes(PAYMENT_APPROVAL_NODES) : PAYMENT_APPROVAL_NODES) as unknown as Prisma.InputJsonValue,
        applicantUserId
      }
    });
    await this.approvalNotifications?.queue(tx, payment, round, null);
    if (revision) {
      await this.audit.record(tx, {
        actorUserId: applicantUserId, action: "payment.request.revise_and_submit", businessType: "payment_request", businessId: payment.id,
        metadata: {
          previousApprovalInstanceId: revision.previousRoundId, approvalInstanceId: round.id,
          previousRequestedAmountCents: revision.draft.requestedAmountCents.toString(),
          requestedAmountCents: payment.requestedAmountCents.toString(),
          previousPaymentMatter: revision.draft.paymentMatter,
          previousAmountCalculationExplanation: revision.draft.amountCalculationExplanation
        }
      });
    } else {
      await this.recordPaymentRequestCreated(tx, payment, applicantUserId);
    }
    if (!this.businessEntry || !["settlement", "signed_settlement"].includes(payment.sourceType)) return payment;
    const target = { projectId: payment.projectId, entityType: "payment_request", entityId: payment.id };
    const snapshot = revision ? await tx.businessEntrySubmissionSnapshot.findFirst({
      where: { ...target, sceneKey: PAYMENT_REQUEST_ENTRY_DEFINITION.key },
      orderBy: { revision: "desc" },
      select: { revision: true }
    }) : null;
    const businessEntrySnapshot = await this.businessEntry.freezeSubmissionSnapshotInTransaction(tx, applicantUserId, {
      sceneKey: PAYMENT_REQUEST_ENTRY_DEFINITION.key,
      definitionVersion: PAYMENT_REQUEST_ENTRY_DEFINITION.version,
      target, expectedRevision: snapshot?.revision ?? 0, values: paymentRequestEntryValues(payment)
    });
    return { ...payment, businessEntrySnapshot };
  }

  private async submitPaymentRequest(
    tx: Prisma.TransactionClient,
    normalizedInput: NormalizedCreatePaymentRequest,
    applicantUserId?: string,
    revision?: PaymentRevision
  ) {
    const sourceType = normalizedInput.sourceType ?? "settlement";
    if (sourceType === "contract_advance") {
      return this.createContractAdvancePaymentRequest(tx, normalizedInput, applicantUserId, revision);
    }

    if (sourceType === "contract_due") {
      return this.createContractDuePaymentRequest(tx, normalizedInput, applicantUserId, revision);
    }

    if (sourceType === "signed_settlement") {
      return this.createSignedSettlementPaymentRequest(tx, normalizedInput, applicantUserId, revision);
    }

    if (sourceType !== "settlement") {
      throw new Error("不支持的付款申请来源，请从结算或合同付款入口发起");
    }

    if (normalizedInput.signedSettlementId) {
      throw new BadRequestException("已签结算依据只能用于已签结算付款来源");
    }

    if (!normalizedInput.settlementId) {
      throw new Error("请选择已归档生效的结算后再发起付款申请");
    }

    let settlement = await tx.settlement.findUnique({
      where: { id: normalizedInput.settlementId }
    });

    if (!settlement) {
      throw new Error("未找到结算记录，请刷新结算台账后重试");
    }

    this.assertSettlementEffective(settlement.status as SettlementStatus);
    await this.lockContractPaymentCapacityRows(tx, settlement.contractId);
    settlement = await tx.settlement.findUnique({
      where: { id: settlement.id }
    });
    if (!settlement) {
      throw new Error("未找到结算记录，请刷新结算台账后重试");
    }
    this.assertSettlementEffective(settlement.status as SettlementStatus);
    const settlementContract = await tx.contract.findUnique({
      where: { id: settlement.contractId },
      select: { contractTypeKey: true }
    });
    if (!settlementContract) {
      throw new Error("未找到关联合同，请刷新合同台账后重试");
    }
    if (!SETTLEMENT_PAYMENT_CONTRACT_TYPES.has(settlementContract.contractTypeKey ?? "")) {
      throw new BadRequestException("该合同类型应从合同已冻结的付款阶段发起付款");
    }
    const settlementContractVersion = await tx.contractVersion.findUnique({
      where: { id: settlement.contractVersionId },
      select: { signingSubjectType: true }
    });
    const paymentSubjectType = paymentSubjectForSigningSubject(
      normalizedInput.paymentSubjectType,
      settlementContractVersion?.signingSubjectType
    );
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: settlement.contractId,
      contractVersionId: settlement.contractVersionId,
      sourceType: "settlement",
      actorUserId: applicantUserId
    });

    const existingApprovedOrPending = await tx.paymentRequest.findMany({
      where: {
        settlementId: settlement.id,
        status: {
          in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES]
        }
      }
    });
    const proxyPaidCents = await this.sumProjectProxyPaymentCents(tx, settlement.id);
    const contractDueAllocatedCents = await this.sumContractDueAllocatedCentsForSettlement(
      tx,
      settlement.id
    );
    const capacityView = calculateSettlementPaymentCapacityBigInt({
      payableAmountCents: settlement.payableAmountCents,
      actualPaidAmountCents: settlement.paidAmountCents,
      proxyPaidAmountCents:
        dbMoneyToBigInt(proxyPaidCents, "项目代付金额") +
        dbMoneyToBigInt(contractDueAllocatedCents, "合同到期付款分摊金额"),
      paymentRequests: existingApprovedOrPending
    });
    const capacity: PaymentCapacity = {
      payableAmountCents: settlement.payableAmountCents,
      approvedPendingPaymentCents: capacityView.outstandingPaymentCents,
      paidAmountCents:
        dbMoneyToBigInt(settlement.paidAmountCents, "结算已付金额") +
        dbMoneyToBigInt(proxyPaidCents, "项目代付金额") +
        dbMoneyToBigInt(contractDueAllocatedCents, "合同到期付款分摊金额")
    };

    this.amount.assertCanRequest(capacity, normalizedInput.requestedAmountCents);
    await this.assertContractDuePaymentCapacity(tx, settlement, normalizedInput.requestedAmountCents);
    const payment = await this.persistPaymentSubmission(tx, {
      projectId: settlement.projectId,
      settlementId: settlement.id,
      sourceType: "settlement",
      paymentSubjectType,
      contractId: settlement.contractId,
      contractVersionId: settlement.contractVersionId,
      paymentTermsVersionId: settlement.paymentTermsVersionId,
      code: normalizedInput.code,
      status: "approval_pending",
      requestedAmountCents: normalizedInput.requestedAmountCents,
      approvedAmountCents: null,
      paidAmountCents: 0n,
      ...(optionalTrimmedText(normalizedInput.paymentMatter) ? { paymentMatter: optionalTrimmedText(normalizedInput.paymentMatter) } : {}),
      ...(optionalTrimmedText(normalizedInput.amountCalculationExplanation) ? { amountCalculationExplanation: optionalTrimmedText(normalizedInput.amountCalculationExplanation) } : {})
    }, revision);
    return this.finishPaymentSubmission(tx, payment, applicantUserId, revision);
  }

  /**
   * 已签结算付款：只锁定“最近确认的一期”，金额上限按合同累计结算
   * （含负数、旧结算与历史起点）扣减全部已占用额度后计算。依据选择、
   * 合同/条款版本和金额校验全部在本事务内完成。
   */
  private async createSignedSettlementPaymentRequest(
    tx: Prisma.TransactionClient,
    input: NormalizedCreatePaymentRequest,
    applicantUserId?: string,
    revision?: PaymentRevision
  ) {
    if (input.settlementId) {
      throw new BadRequestException("已签结算付款不能同时选择旧结算单");
    }
    if (!input.signedSettlementId) {
      throw new BadRequestException("请选择最近确认的已签结算后再发起付款申请");
    }

    const signedSettlement = await tx.signedContractSettlement.findUnique({
      where: { id: input.signedSettlementId }
    });
    if (!signedSettlement) {
      throw new Error("未找到已签结算记录，请刷新结算台账后重试");
    }
    if (signedSettlement.contractKind !== SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND) {
      throw new BadRequestException("表外或对上结算不产生我方付款申请，请从对应关系台账办理");
    }
    if (signedSettlement.state !== "confirmed") {
      throw new Error("当前已签结算尚未复核确认，不能发起付款申请");
    }

    const contract = await tx.contract.findUnique({
      where: { id: signedSettlement.contractId },
      select: { projectId: true, contractTypeKey: true, voidedAt: true }
    });
    if (!contract) {
      throw new Error("未找到关联合同，请刷新合同台账后重试");
    }
    if (contract.projectId !== signedSettlement.projectId) {
      throw new BadRequestException("已签结算与关联合同的项目归属不一致，请先核对结算登记");
    }
    if (contract.voidedAt) {
      throw new BadRequestException("关联合同已作废，不能发起付款申请");
    }
    if (!SETTLEMENT_PAYMENT_CONTRACT_TYPES.has(contract.contractTypeKey ?? "")) {
      throw new BadRequestException("该合同类型应从合同已冻结的付款阶段发起付款");
    }

    const contractVersion = await tx.contractVersion.findFirst({
      where: { contractId: signedSettlement.contractId, status: "effective" },
      orderBy: { versionNo: "desc" },
      select: { id: true, signingSubjectType: true }
    });
    if (!contractVersion) {
      throw new Error("合同尚未归档生效，不能发起付款申请");
    }
    const paymentTermsVersion = await tx.paymentTermsVersion.findFirst({
      where: { contractId: signedSettlement.contractId, contractVersionId: contractVersion.id, status: "effective" },
      orderBy: { versionNo: "desc" },
      select: { id: true }
    });
    if (!paymentTermsVersion) {
      throw new Error("未找到已生效的付款条款，请先补齐合同付款条款");
    }
    const paymentSubjectType = paymentSubjectForSigningSubject(
      input.paymentSubjectType,
      contractVersion.signingSubjectType
    );
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: signedSettlement.contractId,
      contractVersionId: contractVersion.id,
      sourceType: "signed_settlement",
      actorUserId: applicantUserId
    });

    await this.lockContractPaymentCapacityRows(tx, signedSettlement.contractId);
    const basis = await loadSignedSettlementPaymentBasis(tx, signedSettlement.contractId, {
      lock: true
    });
    if (basis.latestConfirmed.id !== signedSettlement.id) {
      throw new ConflictException(
        "付款只可选择最近确认的一期已签结算，请刷新结算依据后重新选择"
      );
    }
    if (input.requestedAmountCents > basis.remainingCents) {
      await this.recordPaymentCapacityBlocked(tx, {
        actorUserId: applicantUserId,
        businessType: "contract",
        businessId: signedSettlement.contractId,
        reason: "signed_settlement_cumulative_exceeded",
        contractId: signedSettlement.contractId,
        signedSettlementId: signedSettlement.id,
        requestedAmountCents: input.requestedAmountCents,
        basis
      });
      throw new BadRequestException(
        `合同已签结算累计可付金额不足，当前最多可申请 ${formatMoneyCentsAsYuan(
          basis.remainingCents
        )} 元`
      );
    }

    const basisAt = new Date();
    const payment = await this.persistPaymentSubmission(tx, {
      projectId: signedSettlement.projectId,
      settlementId: null,
      signedSettlementId: signedSettlement.id,
      signedSettlementConfirmationNo: basis.latestConfirmed.confirmationNo,
      signedSettlementConfirmedYuan: basis.latestConfirmed.amountYuan,
      signedSettlementContractConfirmedYuan: basis.confirmedContractYuan,
      signedSettlementOccupiedCents: basis.occupiedCents,
      signedSettlementBasisAt: basisAt,
      sourceType: "signed_settlement",
      paymentSubjectType,
      contractId: signedSettlement.contractId,
      contractVersionId: contractVersion.id,
      paymentTermsVersionId: paymentTermsVersion.id,
      code: input.code,
      status: "approval_pending",
      requestedAmountCents: input.requestedAmountCents,
      approvedAmountCents: null,
      paidAmountCents: 0n,
      ...(optionalTrimmedText(input.paymentMatter)
        ? { paymentMatter: optionalTrimmedText(input.paymentMatter) }
        : {}),
      ...(optionalTrimmedText(input.amountCalculationExplanation)
        ? { amountCalculationExplanation: optionalTrimmedText(input.amountCalculationExplanation) }
        : {})
    }, revision);
    return this.finishPaymentSubmission(tx, payment, applicantUserId, revision);
  }

  private async createContractDuePaymentRequest(
    tx: Prisma.TransactionClient,
    input: NormalizedCreatePaymentRequest,
    applicantUserId?: string,
    revision?: PaymentRevision
  ) {
    if (input.settlementId) {
      throw new Error("按合同应付款发起付款时不能选择结算，请从合同付款入口办理");
    }

    if (!input.contractVersionId) {
      throw new Error("请选择已归档生效的合同后再发起付款申请");
    }

    const contractVersion = await tx.contractVersion.findUnique({
      where: { id: input.contractVersionId },
      select: {
        id: true,
        contractId: true,
        status: true,
        amountCents: true,
        amountYuan: true,
        amountLimitType: true,
        effectiveAt: true,
        settlementMode: true,
        settlementModeConfirmedAt: true,
        settlementModeConfirmedByUserId: true,
        numericProtocolVersion: true,
        signingSubjectType: true
      }
    });
    if (!contractVersion) {
      throw new Error("未找到合同版本，请刷新合同台账后重试");
    }
    if (contractVersion.status !== "effective") {
      throw new Error("当前合同尚未归档生效，不能发起付款申请");
    }
    const paymentSubjectType = paymentSubjectForSigningSubject(
      input.paymentSubjectType,
      contractVersion.signingSubjectType
    );
    const contract = await tx.contract.findUnique({
      where: { id: contractVersion.contractId },
      select: { projectId: true, contractTypeKey: true, voidedAt: true }
    });
    if (!contract) {
      throw new Error("未找到关联合同，请刷新合同台账后重试");
    }
    // `undefined` only exists in pre-migration test doubles. A persisted legacy
    // value is NULL and must be confirmed before ordinary contract-due payment.
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
        throw new BadRequestException("该合同已确认需要结算，应从生效结算发起付款");
      }
    } else if (contract.contractTypeKey !== "generic_contract") {
      throw new BadRequestException("该合同类型应从生效结算发起付款");
    }
    const textAgreement = !input.paymentTermsStageId &&
      (revision ? revision.draft.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS
        : isConfirmedTextAgreementContract(contract, contractVersion));
    if (!input.paymentTermsStageId && !textAgreement) {
      throw new Error("请选择合同已冻结的付款阶段");
    }
    if (textAgreement) await this.lockContractAdvancePaymentRows(tx, contractVersion.contractId);
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: contractVersion.contractId,
      contractVersionId: contractVersion.id,
      sourceType: "contract_due",
      actorUserId: applicantUserId
    });

    const paymentTermsVersion = await tx.paymentTermsVersion.findFirst({
      where: {
        ...((!textAgreement || revision) && input.paymentTermsVersionId ? { id: input.paymentTermsVersionId } : {}),
        contractVersionId: contractVersion.id,
        status: "effective"
      },
      orderBy: { versionNo: "desc" }
    });
    if (!paymentTermsVersion) {
      throw new Error("未找到已生效的付款条款，请先补齐合同付款条款");
    }

    if (textAgreement && paymentTermsVersion.id !== input.paymentTermsVersionId) {
      throw new ConflictException("合同付款约定已变化，请重新核对后再申请");
    }
    if (textAgreement && !revision) {
      const actualStage = await tx.paymentTermsStage.findFirst({
        where: { paymentTermsVersionId: paymentTermsVersion.id }, select: { id: true }
      });
      if (actualStage) throw new BadRequestException("请选择合同已冻结的付款阶段");
      if (!paymentTermsVersion.originalText.trim()) throw new BadRequestException("合同缺少有效的付款约定");
      const agreement = await readTextPaymentAgreement(tx, {
        contractVersionId: contractVersion.id,
        paymentTermsVersionId: paymentTermsVersion.id,
        contractId: contractVersion.contractId,
        projectId: contract.projectId
      });
      if (!agreement || agreement.fingerprint !== input.expectedAgreementFingerprint) {
        throw new ConflictException("合同付款约定已变化，请重新核对后再申请");
      }
    }
    const paymentTermsStage = input.paymentTermsStageId ? await tx.paymentTermsStage.findUnique({
      where: { id: input.paymentTermsStageId },
      select: {
        id: true,
        paymentTermsVersionId: true,
        stageType: true,
        basis: true,
        ratioBps: true,
        fixedAmountCents: true,
        triggerAnchor: true,
        dueDays: true,
        allowsEarlyPayment: true,
        allowsInstallments: true
      }
    }) : null;
    if (!textAgreement) this.assertGenericContractPaymentStage(paymentTermsStage, paymentTermsVersion.id);
    const paymentMatter = optionalTrimmedText(input.paymentMatter);
    const amountCalculationExplanation = optionalTrimmedText(
      input.amountCalculationExplanation
    );
    const amountNature = directPaymentAmountNature(contractVersion);
    if (
      (paymentMatter === null) !== (amountCalculationExplanation === null)
    ) {
      throw new BadRequestException(
        "本次付款事项和金额计算说明必须同时填写"
      );
    }
    if (
      (textAgreement || amountNature === "unlimited_total") &&
      (paymentMatter === null || amountCalculationExplanation === null)
    ) {
      throw new BadRequestException(
        textAgreement ? "按合同付款须填写本次付款事项和金额计算说明"
          : "无固定总价合同必须填写本次付款事项和金额计算说明"
      );
    }

    await this.assertDirectPaymentApplicationCapacity(
      tx,
      contractVersion,
      paymentTermsStage,
      input.requestedAmountCents,
      textAgreement ? await readTextAgreementContractLimit(tx, contractVersion, contract.projectId) : null
    );
    const payment = await this.persistPaymentSubmission(tx, {
      projectId: contract.projectId,
      settlementId: null,
      sourceType: "contract_due",
      paymentSubjectType,
      contractId: contractVersion.contractId,
      contractVersionId: contractVersion.id,
      paymentTermsVersionId: paymentTermsVersion.id,
      paymentTermsStageId: paymentTermsStage?.id ?? null,
      ...(textAgreement ? { contractDueBasis: PAYMENT_TEXT_AGREEMENT_BASIS } : {}),
      code: input.code,
      status: "approval_pending",
      requestedAmountCents: input.requestedAmountCents,
      approvedAmountCents: null,
      paidAmountCents: 0n,
      ...(paymentMatter === null || amountCalculationExplanation === null
        ? {}
        : { paymentMatter, amountCalculationExplanation })
    }, revision);
    return this.finishPaymentSubmission(tx, payment, applicantUserId, revision);
  }

  private assertGenericContractPaymentStage(
    stage: {
      paymentTermsVersionId: string;
      stageType: string;
      basis: string;
      triggerAnchor: string;
      ratioBps: number | null;
      fixedAmountCents: bigint | null;
      dueDays: number;
    } | null,
    paymentTermsVersionId: string
  ): void {
    if (!stage) {
      throw new BadRequestException("请选择合同已冻结的付款阶段");
    }
    const hasValidRatio =
      stage.ratioBps !== null &&
      Number.isInteger(stage.ratioBps) &&
      stage.ratioBps > 0 &&
      stage.ratioBps <= 10000;
    const hasValidFixedAmount =
      stage.fixedAmountCents !== null && stage.fixedAmountCents > 0n;
    if (
      stage.paymentTermsVersionId !== paymentTermsVersionId ||
      stage.stageType === "advance" ||
      stage.basis !== "contract_amount" ||
      stage.triggerAnchor !== "contract_effective" ||
      hasValidRatio === hasValidFixedAmount ||
      !Number.isSafeInteger(stage.dueDays) ||
      stage.dueDays < 0
    ) {
      throw new BadRequestException("请选择合同已冻结的付款阶段");
    }
  }

  private async assertDirectPaymentApplicationCapacity(
    tx: Prisma.TransactionClient,
    contractVersion: {
      id: string;
      contractId: string;
      amountCents: bigint;
      amountLimitType: string;
      effectiveAt: Date | null;
    },
    stage: {
      id: string;
      paymentTermsVersionId: string;
      stageType: string;
      basis: string;
      ratioBps: number | null;
      fixedAmountCents: bigint | null;
      triggerAnchor: string;
      dueDays: number;
      allowsEarlyPayment: boolean;
      allowsInstallments: boolean;
    } | null,
    requestedAmountCents: bigint,
    textAgreementLimit: bigint | null,
    excludedRequestId?: string
  ): Promise<void> {
    if (stage) await this.lockContractAdvancePaymentRows(tx, contractVersion.contractId);
    const effectiveAt = contractVersion.effectiveAt;
    if (!effectiveAt) {
      throw new BadRequestException("合同生效日期缺失，不能核算冻结付款阶段");
    }
    const dueAt = stage ? new Date(
      effectiveAt.getTime() + Math.max(stage.dueDays, 0) * 24 * 60 * 60 * 1000
    ) : null;
    const amountNature = directPaymentAmountNature(contractVersion);
    if (stage ? amountNature === "unlimited_total" : textAgreementLimit === null) {
      if (stage && dueAt && dueAt > new Date() && !stage.allowsEarlyPayment) {
        throw new BadRequestException(
          "合同冻结付款阶段尚未到期，不能提前发起付款申请"
        );
      }
      return;
    }
    const contractAmountCents = textAgreementLimit ?? dbMoneyToBigInt(contractVersion.amountCents, "合同金额");
    const occupiedRequests = await tx.paymentRequest.findMany({
      where: {
        contractId: contractVersion.contractId,
        ...(excludedRequestId ? { id: { not: excludedRequestId } } : {}),
        status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES, "paid"] }
      },
      select: {
        paymentTermsStageId: true,
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
      }
    });
    const requestOccupiedCents = (request: {
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
      paidAmountCents: bigint;
    }) => request.paidAmountCents + this.paymentRequestOutstandingCents(request);
    const allStageOccupiedCents = occupiedRequests.reduce(
      (total, request) => total + requestOccupiedCents(request),
      0n
    );
    const [proxyPaidCents, historicalBalance] = await Promise.all([
      this.sumProjectProxyPaymentCentsForContract(tx, contractVersion.contractId, []),
      this.confirmedHistoricalBalanceForContract(tx, contractVersion.contractId)
    ]);
    const historicalAdvanceUnrecoveredCents = historicalBalance
      ? (historicalBalance.advancePaidCents ?? 0n) -
        (historicalBalance.advanceDeductedCents ?? 0n)
      : 0n;
    const historicalRetentionUnreleasedCents = historicalBalance
      ? (historicalBalance.retentionWithheldCents ?? 0n) -
        (historicalBalance.retentionReleasedCents ?? 0n)
      : 0n;
    const historicalOccupiedCents = historicalBalance
      ? (historicalBalance.paidCents ?? 0n) +
        (historicalBalance.approvalPendingPaymentCents ?? 0n) +
        (historicalBalance.approvedPendingPaymentCents ?? 0n) +
        (historicalBalance.proxyPaidCents ?? 0n) +
        (historicalAdvanceUnrecoveredCents > 0n ? historicalAdvanceUnrecoveredCents : 0n) +
        (historicalRetentionUnreleasedCents > 0n ? historicalRetentionUnreleasedCents : 0n) +
        (historicalBalance.otherConfirmedOccupancyCents ?? 0n)
      : 0n;
    const contractRemainingCents =
      contractAmountCents - allStageOccupiedCents - proxyPaidCents - historicalOccupiedCents;
    if (!stage) {
      if (requestedAmountCents > contractRemainingCents) {
        throw new BadRequestException(`合同当前可申请金额不足，当前最多可申请 ${formatMoneyCentsAsYuan(
          contractRemainingCents > 0n ? contractRemainingCents : 0n
        )} 元`);
      }
      return;
    }
    const configuredAmountCents = stage.fixedAmountCents !== null
      ? dbMoneyToBigInt(stage.fixedAmountCents, "付款阶段固定金额")
      : (contractAmountCents * BigInt(Math.max(stage.ratioBps ?? 0, 0))) / 10000n;
    const stagePayableCents = (dueAt && dueAt <= new Date()) || stage.allowsEarlyPayment
      ? (configuredAmountCents < contractAmountCents ? configuredAmountCents : contractAmountCents)
      : 0n;
    const occupiedCents = occupiedRequests
      .filter((request) => request.paymentTermsStageId === stage.id)
      .reduce((total, request) => total + requestOccupiedCents(request), 0n);
    const stageRemainingCents = stagePayableCents - occupiedCents;
    const remainingCents = stageRemainingCents < contractRemainingCents
      ? stageRemainingCents
      : contractRemainingCents;
    if (stage.allowsInstallments === false && occupiedCents > 0n) {
      throw new BadRequestException("该付款阶段不允许分次申请，已有付款申请占用该阶段额度");
    }
    if (stage.allowsInstallments === false && requestedAmountCents !== remainingCents) {
      throw new BadRequestException(
        `该付款阶段不允许分次申请，本次申请金额必须等于当前可申请金额 ${formatMoneyCentsAsYuan(
          remainingCents > 0n ? remainingCents : 0n
        )} 元`
      );
    }
    if (requestedAmountCents > remainingCents) {
      throw new BadRequestException(
        `合同付款阶段当前可申请金额不足，当前最多可申请 ${formatMoneyCentsAsYuan(
          remainingCents > 0n ? remainingCents : 0n
        )} 元`
      );
    }
  }

  private async assertTextAgreementCapacity(
    tx: Prisma.TransactionClient,
    payment: { id: string; contractId: string; contractVersionId: string; projectId: string },
    proposedOccupiedCents: bigint
  ): Promise<void> {
    await this.lockContractAdvancePaymentRows(tx, payment.contractId);
    const version = await tx.contractVersion.findUnique({
      where: { id: payment.contractVersionId },
      select: { id: true, contractId: true, effectiveAt: true, amountCents: true, amountYuan: true, amountLimitType: true }
    });
    if (!version || version.contractId !== payment.contractId) {
      throw new ConflictException("付款申请的冻结合同版本不可核对");
    }
    const limit = await readTextAgreementContractLimit(tx, version, payment.projectId);
    await this.assertDirectPaymentApplicationCapacity(tx, version, null, proposedOccupiedCents, limit, payment.id);
  }

  private async createContractAdvancePaymentRequest(
    tx: Prisma.TransactionClient,
    input: NormalizedCreatePaymentRequest,
    applicantUserId?: string,
    revision?: PaymentRevision
  ) {
    if (!input.contractVersionId) {
      throw new Error("请选择已归档生效的合同后再发起付款申请");
    }

    const contractVersion = await tx.contractVersion.findUnique({
      where: { id: input.contractVersionId },
      select: {
        id: true,
        contractId: true,
        status: true,
        amountCents: true,
        effectiveAt: true,
        signingSubjectType: true
      }
    });
    if (!contractVersion) {
      throw new Error("未找到合同版本，请刷新合同台账后重试");
    }
    if (contractVersion.status !== "effective") {
      throw new Error("当前合同尚未归档生效，不能发起付款申请");
    }
    if (!contractVersion.effectiveAt) {
      throw new Error("合同生效日期缺失，不能发起预付款申请");
    }
    const paymentSubjectType = paymentSubjectForSigningSubject(
      input.paymentSubjectType,
      contractVersion.signingSubjectType
    );
    if (paymentSubjectType === "affiliate" && !revision) {
      throw new BadRequestException("施工企业合同预付款已停止新增申请");
    }
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: contractVersion.contractId,
      contractVersionId: contractVersion.id,
      sourceType: "contract_advance",
      actorUserId: applicantUserId
    });

    const contract = await tx.contract.findUnique({
      where: { id: contractVersion.contractId },
      select: { projectId: true, contractTypeKey: true }
    });
    if (!contract) {
      throw new Error("未找到关联合同，请刷新合同台账后重试");
    }
    if (
      contract.contractTypeKey !== "generic_contract" &&
      !SETTLEMENT_PAYMENT_CONTRACT_TYPES.has(contract.contractTypeKey ?? "")
    ) {
      throw new BadRequestException("请先明确合同类型，再发起预付款申请");
    }

    await this.lockContractAdvancePaymentRows(tx, contractVersion.contractId);

    const paymentTermsVersion = await tx.paymentTermsVersion.findFirst({
      where: {
        ...(input.paymentTermsVersionId ? { id: input.paymentTermsVersionId } : {}),
        contractVersionId: contractVersion.id,
        status: "effective"
      },
      orderBy: { versionNo: "desc" }
    });
    if (!paymentTermsVersion) {
      throw new Error("未找到已生效的付款条款，请先补齐合同付款条款");
    }

    const paymentTermsStages = await tx.paymentTermsStage.findMany({
      where: {
        paymentTermsVersionId: paymentTermsVersion.id,
        stageType: "advance",
        basis: "contract_amount",
        triggerAnchor: "contract_effective"
      },
      select: {
        paymentTermsVersionId: true,
        stageType: true,
        basis: true,
        ratioBps: true,
        fixedAmountCents: true,
        triggerAnchor: true,
        dueDays: true
      }
    });
    const existingAdvancePayments = await tx.paymentRequest.findMany({
      where: {
        contractId: contractVersion.contractId,
        sourceType: "contract_advance",
        status: { in: [...PROJECT_CASH_POOL_PAYMENT_STATUSES] }
      },
      select: {
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
      }
    });
    const historicalBalance = await this.confirmedHistoricalBalanceForContract(
      tx,
      contractVersion.contractId
    );
    const capacity = calculateContractAdvancePaymentCapacityBigInt({
      asOf: new Date(),
      contractAmountCents: dbMoneyToBigInt(contractVersion.amountCents, "合同金额"),
      contractEffectiveAt: contractVersion.effectiveAt,
      paymentTermsStages,
      paymentRequests: existingAdvancePayments,
      historicalBalance
    });

    if (input.requestedAmountCents > capacity.remainingCents) {
      throw new BadRequestException(
        `合同预付款当前可申请金额不足，当前最多可申请 ${formatMoneyCentsAsYuan(
          capacity.remainingCents > 0n ? capacity.remainingCents : 0n
        )} 元`
      );
    }

    const payment = await this.persistPaymentSubmission(tx, {
      projectId: contract.projectId,
      settlementId: null,
      sourceType: "contract_advance",
      paymentSubjectType,
      contractId: contractVersion.contractId,
      contractVersionId: contractVersion.id,
      paymentTermsVersionId: paymentTermsVersion.id,
      code: input.code,
      status: "approval_pending",
      requestedAmountCents: input.requestedAmountCents,
      approvedAmountCents: null,
      paidAmountCents: 0n,
      ...(revision ? {
        paymentMatter: optionalTrimmedText(input.paymentMatter),
        amountCalculationExplanation: optionalTrimmedText(input.amountCalculationExplanation)
      } : {})
    }, revision);
    return this.finishPaymentSubmission(tx, payment, applicantUserId, revision);
  }

  private async assertContractDuePaymentCapacity(
    tx: Prisma.TransactionClient,
    settlement: {
      id: string;
      contractId: string;
      contractVersionId?: string;
      amountCents: bigint;
      paymentTermsVersionId: string;
    },
    requestedAmountCents: bigint
  ): Promise<void> {
    await this.assertContractDuePaymentCapacityForContract(
      tx,
      settlement.contractId,
      settlement.paymentTermsVersionId,
      requestedAmountCents
    );
  }

  private async assertContractDuePaymentCapacityForContract(
    tx: Prisma.TransactionClient,
    contractId: string,
    paymentTermsVersionId: string | undefined,
    requestedAmountCents: bigint
  ): Promise<void> {
    const paymentTermsStageClient = (tx as unknown as {
      paymentTermsStage?: {
        findMany: (args: {
          where: {
            paymentTermsVersionId: { in: string[] };
            OR: Array<{ basis?: string; stageType?: string }>;
          };
          select: {
            paymentTermsVersionId: true;
            stageType: true;
            basis: true;
            ratioBps: true;
            fixedAmountCents: true;
            triggerAnchor: true;
            dueDays: true;
            advanceDeductionMode: true;
            advanceDeductionRatioBps: true;
            advanceDeductionStartRatioBps: true;
          };
        }) => Promise<
          Array<{
            paymentTermsVersionId: string;
            stageType: string;
            basis: string;
            ratioBps: number | null;
            fixedAmountCents: bigint | null;
            triggerAnchor: string;
            dueDays: number;
            advanceDeductionMode: string | null;
            advanceDeductionRatioBps: number | null;
            advanceDeductionStartRatioBps: number | null;
          }>
        >;
      };
      settlementArchiveFile?: {
        findMany: (args: {
          where: {
            settlementId: { in: string[] };
            status: string;
            confirmedAt: { not: null };
          };
          select: { settlementId: true; confirmedAt: true };
        }) => Promise<Array<{ settlementId: string; confirmedAt: Date | null }>>;
      };
    });

    if (!paymentTermsStageClient.paymentTermsStage || !paymentTermsStageClient.settlementArchiveFile) {
      return;
    }

    await this.lockContractPaymentCapacityRows(tx, contractId);

    const contractSettlements = await tx.settlement.findMany({
      where: {
        contractId,
        status: { in: [...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES] }
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
        paidAmountCents: true,
        contractVersionId: true,
        isFinal: true,
        paymentTermsVersionId: true,
        sourceType: true,
        sourceTakeoverId: true
      }
    });
    const settlementIds = contractSettlements.map((row) => row.id);
    const historicalBalance = await this.confirmedHistoricalBalanceForContract(tx, contractId);
    const paymentTermsVersionIds = [
      ...new Set([
        ...contractSettlements.map((row) => row.paymentTermsVersionId),
        ...(historicalBalance?.paymentTermsVersionId ? [historicalBalance.paymentTermsVersionId] : []),
        ...(paymentTermsVersionId ? [paymentTermsVersionId] : [])
      ])
    ];

    if (!paymentTermsVersionIds.length) {
      throw new BadRequestException("合同应付款当前可申请金额不足，当前最多可申请 0.00 元");
    }

    const [paymentTermsStages, settlementArchiveFiles, contractPaymentRequests, proxyPaidAmountCents] =
      await Promise.all([
        paymentTermsStageClient.paymentTermsStage.findMany({
          where: {
            paymentTermsVersionId: { in: paymentTermsVersionIds },
            OR: [{ basis: "current_settlement" }, { stageType: "advance" }]
          },
          select: {
            paymentTermsVersionId: true,
            stageType: true,
            basis: true,
            ratioBps: true,
            fixedAmountCents: true,
            triggerAnchor: true,
            dueDays: true,
            advanceDeductionMode: true,
            advanceDeductionRatioBps: true,
            advanceDeductionStartRatioBps: true
          }
        }),
        loadSettlementPaymentConfirmationFacts(tx, settlementIds),
        tx.paymentRequest.findMany({
          where: {
            contractId,
            sourceType: { in: ["settlement", "contract_due"] },
            status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES, "paid"] }
          },
          select: {
            settlementId: true,
            sourceType: true,
            status: true,
            requestedAmountCents: true,
            approvedAmountCents: true,
            paidAmountCents: true
          }
        }),
        this.sumProjectProxyPaymentCentsForContract(tx, contractId, settlementIds)
      ]);
    const advancePaymentRequests = await tx.paymentRequest.findMany({
      where: {
        contractId,
        sourceType: "contract_advance",
        paymentTermsVersionId: { in: paymentTermsVersionIds },
        paidAmountCents: { gt: 0 }
      },
      select: {
        paymentTermsVersionId: true,
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
      }
    });
    const contractAmountCentsByPaymentTermsVersionId =
      await this.contractAmountCentsByPaymentTermsVersionIdForCapacity(
      tx,
      contractSettlements
    );

    const capacity = calculateContractDuePaymentCapacityBigInt({
      asOf: new Date(),
      settlements: contractSettlements,
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests: contractPaymentRequests,
      proxyPaidAmountCents,
      contractAmountCents: paymentTermsVersionId
        ? contractAmountCentsByPaymentTermsVersionId[paymentTermsVersionId]
        : undefined,
      contractAmountCentsByPaymentTermsVersionId,
      advancePaymentRequests,
      historicalBalance
    });

    if (dbMoneyToBigInt(requestedAmountCents, "付款申请金额") > capacity.remainingCents) {
      throw new BadRequestException(
        `合同应付款当前可申请金额不足，当前最多可申请 ${formatMoneyCentsAsYuan(
          capacity.remainingCents > 0n ? capacity.remainingCents : 0n
        )} 元`
      );
    }
  }

  /**
   * 实付时再次校验已签结算依据：同一合同 advisory lock 下重读累计结算与全部占用，
   * 当前申请自身在途金额先还原，再判断本次实付是否仍可被合同累计覆盖。
   */
  private async assertSignedSettlementPaymentExecutionCapacity(
    tx: Prisma.TransactionClient,
    payment: PaymentExecutionLockRow,
    amountCents: bigint,
    actorUserId: string
  ): Promise<void> {
    if (!payment.signedSettlementId) {
      throw new ConflictException("付款申请缺少已签结算依据，请刷新并核对原申请");
    }
    const signedSettlement = await tx.signedContractSettlement.findUnique({
      where: { id: payment.signedSettlementId },
      select: { id: true, contractKind: true, contractId: true, state: true }
    });
    if (!signedSettlement) {
      throw new ConflictException("未找到付款申请关联的已签结算，请刷新后核对");
    }
    if (
      signedSettlement.contractKind !== SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND ||
      signedSettlement.contractId !== payment.contractId
    ) {
      throw new ConflictException("付款申请的已签结算依据与合同不一致，请核对原申请");
    }
    if (signedSettlement.state !== "confirmed") {
      throw new Error("已签结算依据已失效，不能登记实付");
    }
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: payment.contractId,
      contractVersionId: payment.contractVersionId,
      sourceType: "signed_settlement",
      actorUserId,
      actionLabel: "登记实付"
    });

    await this.lockContractPaymentCapacityRows(tx, payment.contractId);
    const basis = await loadSignedSettlementPaymentBasis(tx, payment.contractId, {
      lock: true
    });
    if (basis.suspended) {
      await this.recordPaymentCapacityBlocked(tx, {
        actorUserId,
        businessType: "payment_request",
        businessId: payment.id,
        reason: "signed_settlement_capacity_suspended",
        contractId: payment.contractId,
        signedSettlementId: payment.signedSettlementId,
        requestedAmountCents: amountCents,
        basis
      });
      throw new ConflictException(
        "合同已签结算累计可付金额不足，相关未付申请已暂停；请撤回或调整未付金额，或待新结算补足后再办理"
      );
    }
    // 新确认一期可能调增或调减累计；不因“已不是最新”直接阻止旧申请实付，
    // 但本次实付仍须被最新合同累计覆盖（自身在途先还原）。
    const currentOutstanding = this.paymentRequestOutstandingCents(payment);
    const availableCents = basis.rawRemainingCents + currentOutstanding;
    if (amountCents > availableCents) {
      await this.recordPaymentCapacityBlocked(tx, {
        actorUserId,
        businessType: "payment_request",
        businessId: payment.id,
        reason: "signed_settlement_execution_exceeded",
        contractId: payment.contractId,
        signedSettlementId: payment.signedSettlementId,
        requestedAmountCents: amountCents,
        basis
      });
      throw new Error(
        `合同已签结算累计可付金额不足，当前最多可实付 ${
          availableCents > 0n ? formatMoneyCentsAsYuan(availableCents) : "0.00"
        } 元`
      );
    }
    await this.recordPaymentCapacityRecheck(tx, {
      actorUserId,
      paymentId: payment.id,
      stage: "execution",
      contractId: payment.contractId,
      signedSettlementId: payment.signedSettlementId,
      amountCents,
      availableCents,
      basis
    });
  }

  /**
   * 审批通过（最后节点）时按最新合同累计与全部在途占用重校：
   * 调减结算导致合计未付超过新余额时暂停全部受影响申请，不自动挑先付者；
   * 后续新结算使余额足够时由同一计算自动解除暂停。
   */
  private async assertSignedSettlementApprovalCapacity(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      code: string;
      contractId: string;
      contractVersionId: string;
      signedSettlementId: string | null;
      sourceType: string;
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
      paidAmountCents: bigint;
    },
    approvedAmountCents: bigint,
    actorUserId: string
  ): Promise<void> {
    if (!payment.signedSettlementId) {
      throw new ConflictException("付款申请缺少已签结算依据，请刷新并核对原申请");
    }
    const signedSettlement = await tx.signedContractSettlement.findUnique({
      where: { id: payment.signedSettlementId },
      select: { id: true, contractKind: true, contractId: true, state: true }
    });
    if (!signedSettlement) {
      throw new ConflictException("未找到付款申请关联的已签结算，请刷新后核对");
    }
    if (
      signedSettlement.contractKind !== SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND ||
      signedSettlement.contractId !== payment.contractId
    ) {
      throw new ConflictException("付款申请的已签结算依据与合同不一致，请核对原申请");
    }
    if (signedSettlement.state !== "confirmed") {
      throw new Error("已签结算依据已失效，不能完成付款审批");
    }

    await this.lockContractPaymentCapacityRows(tx, payment.contractId);
    const basis = await loadSignedSettlementPaymentBasis(tx, payment.contractId, {
      lock: true
    });
    if (basis.suspended) {
      await this.recordPaymentCapacityBlocked(tx, {
        actorUserId,
        businessType: "payment_request",
        businessId: payment.id,
        reason: "signed_settlement_capacity_suspended",
        contractId: payment.contractId,
        signedSettlementId: payment.signedSettlementId,
        requestedAmountCents: approvedAmountCents,
        basis
      });
      throw new ConflictException(
        "合同已签结算累计可付金额不足，相关未付申请已暂停；请撤回或调整未付金额，或待新结算补足后再办理"
      );
    }
    const currentOutstanding = this.paymentRequestOutstandingCents(payment);
    const availableCents = basis.rawRemainingCents + currentOutstanding;
    if (approvedAmountCents > availableCents) {
      await this.recordPaymentCapacityBlocked(tx, {
        actorUserId,
        businessType: "payment_request",
        businessId: payment.id,
        reason: "signed_settlement_approval_exceeded",
        contractId: payment.contractId,
        signedSettlementId: payment.signedSettlementId,
        requestedAmountCents: approvedAmountCents,
        basis
      });
      throw new BadRequestException(
        `合同已签结算累计可付金额不足，当前最多可批准 ${
          availableCents > 0n ? formatMoneyCentsAsYuan(availableCents) : "0.00"
        } 元`
      );
    }
    await this.recordPaymentCapacityRecheck(tx, {
      actorUserId,
      paymentId: payment.id,
      stage: "approval",
      contractId: payment.contractId,
      signedSettlementId: payment.signedSettlementId,
      amountCents: approvedAmountCents,
      availableCents,
      basis
    });
  }

  private async recordPaymentCapacityRecheck(
    tx: Prisma.TransactionClient,
    input: {
      actorUserId: string;
      paymentId: string;
      stage: "approval" | "execution";
      contractId: string;
      signedSettlementId: string;
      amountCents: bigint;
      availableCents: bigint;
      basis: SignedSettlementPaymentBasis;
    }
  ): Promise<void> {
    await this.audit.record(tx, {
      actorUserId: input.actorUserId,
      action: "payment.capacity.recheck",
      businessType: "payment_request",
      businessId: input.paymentId,
      metadata: {
        stage: input.stage,
        contractId: input.contractId,
        signedSettlementId: input.signedSettlementId,
        amountCents: moneyCentsToApi(input.amountCents),
        availableCents: moneyCentsToApi(input.availableCents),
        confirmedCents: moneyCentsToApi(input.basis.confirmedCents),
        netPaidCents: moneyCentsToApi(input.basis.netPaidCents),
        occupiedCents: moneyCentsToApi(input.basis.occupiedCents),
        outstandingCents: moneyCentsToApi(input.basis.outstandingCents),
        advancePaidCents: moneyCentsToApi(input.basis.advancePaidCents),
        unsettledAdvanceCents: moneyCentsToApi(input.basis.unsettledAdvanceCents),
        overpayCents: moneyCentsToApi(input.basis.overpayCents),
        abnormalOverpayCents: moneyCentsToApi(input.basis.abnormalOverpayCents),
        suspended: input.basis.suspended
      }
    });
  }

  private async recordPaymentCapacityBlocked(
    tx: Prisma.TransactionClient,
    input: {
      actorUserId?: string;
      businessType: "contract" | "payment_request";
      businessId: string;
      reason: string;
      contractId: string;
      signedSettlementId: string;
      requestedAmountCents: bigint;
      basis: SignedSettlementPaymentBasis;
    }
  ): Promise<void> {
    if (!input.actorUserId) {
      return;
    }
    const auditClient = this.auditClientOutsideFailedTransaction(tx);
    await this.audit.record(auditClient, {
      actorUserId: input.actorUserId,
      action: "payment.capacity.blocked",
      businessType: input.businessType,
      businessId: input.businessId,
      metadata: {
        reason: input.reason,
        contractId: input.contractId,
        signedSettlementId: input.signedSettlementId,
        requestedAmountCents: moneyCentsToApi(input.requestedAmountCents),
        remainingCents: moneyCentsToApi(input.basis.remainingCents),
        confirmedCents: moneyCentsToApi(input.basis.confirmedCents),
        occupiedCents: moneyCentsToApi(input.basis.occupiedCents),
        outstandingCents: moneyCentsToApi(input.basis.outstandingCents),
        advancePaidCents: moneyCentsToApi(input.basis.advancePaidCents),
        unsettledAdvanceCents: moneyCentsToApi(input.basis.unsettledAdvanceCents),
        overpayCents: moneyCentsToApi(input.basis.overpayCents),
        abnormalOverpayCents: moneyCentsToApi(input.basis.abnormalOverpayCents),
        suspended: input.basis.suspended
      }
    });
  }

  private async lockContractPaymentCapacityRows(
    tx: Prisma.TransactionClient,
    contractId: string
  ): Promise<void> {
    await this.lockContractAdvancePaymentRows(tx, contractId);
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Settlement"
      WHERE "contractId" = ${contractId}
        AND "status" IN (${Prisma.join([...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES])})
      FOR UPDATE
    `);
  }

  private async contractAmountCentsByPaymentTermsVersionIdForCapacity(
    tx: Prisma.TransactionClient,
    contractSettlements: Array<{
      amountCents: bigint;
      contractVersionId?: string;
      paymentTermsVersionId: string;
    }>
  ): Promise<Record<string, bigint>> {
    const contractVersionClient = (tx as unknown as {
      contractVersion?: {
        findMany: (args: {
          where: { id: { in: string[] } };
          select: { id: true; amountCents: true };
        }) => Promise<Array<{ id: string; amountCents: bigint }>>;
      };
    }).contractVersion;
    const versionIds = [
      ...new Set(contractSettlements.map((settlement) => settlement.contractVersionId).filter(Boolean))
    ] as string[];
    const amountByVersionId =
      contractVersionClient && versionIds.length
        ? new Map(
            (
              await contractVersionClient.findMany({
                where: { id: { in: versionIds } },
                select: { id: true, amountCents: true }
              })
            ).map((version) => [version.id, version.amountCents])
          )
        : new Map<string, bigint>();

    const fallbackAmountCents = sumMoneyCents(
      contractSettlements.map((settlement) => settlement.amountCents)
    );
    const amountByTermsId: Record<string, bigint> = {};
    for (const settlement of contractSettlements) {
      amountByTermsId[settlement.paymentTermsVersionId] =
        (settlement.contractVersionId
          ? amountByVersionId.get(settlement.contractVersionId)
          : undefined) ?? fallbackAmountCents;
    }

    return amountByTermsId;
  }

  private async lockContractAdvancePaymentRows(
    tx: Prisma.TransactionClient,
    contractId: string
  ): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Contract"
      WHERE "id" = ${contractId}
      FOR UPDATE
    `);
  }

  private async releaseFinancingQuotaUsage(
    tx: Prisma.TransactionClient,
    paymentRequestId: string,
    actorUserId: string,
    action: string
  ) {
    const releasedAmountCents = await this.moveFinancingQuotaUsage(
      tx,
      paymentRequestId,
      undefined,
      "released"
    );

    if (releasedAmountCents > 0n) {
      await this.audit.record(tx, {
        actorUserId,
        action,
        businessType: "payment_request",
        businessId: paymentRequestId,
        metadata: { releasedAmountCents: releasedAmountCents.toString() }
      });
    }
  }

  private async shrinkFinancingQuotaUsageToApprovedAmount(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
    },
    approvedAmountCents: bigint,
    actorUserId: string
  ) {
    const usageTotals = await this.financingUsageTotals(tx, payment.id);
    const cashAllocatedCents = payment.requestedAmountCents - usageTotals.occupied - usageTotals.used;
    const targetFinancingCents =
      approvedAmountCents > cashAllocatedCents
        ? approvedAmountCents - cashAllocatedCents
        : 0n;
    const activeFinancingCents = usageTotals.occupied + usageTotals.used;
    const amountToRelease =
      activeFinancingCents > targetFinancingCents ? activeFinancingCents - targetFinancingCents : 0n;
    if (amountToRelease === 0n) {
      return;
    }

    const releasedAmountCents = await this.moveFinancingQuotaUsage(
      tx,
      payment.id,
      amountToRelease,
      "released"
    );
    if (releasedAmountCents > 0n) {
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.financing_quota.release.approval_amount_reduced",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: { releasedAmountCents: releasedAmountCents.toString() }
      });
    }
  }

  private async financingUsageTotals(tx: Prisma.TransactionClient, paymentRequestId: string) {
    const usages = await tx.projectFinancingQuotaUsage.findMany({
      where: { paymentRequestId, status: { in: ["occupied", "used"] } },
      select: { amountCents: true, status: true }
    });
    return usages.reduce(
      (totals, usage) => ({
        occupied:
          totals.occupied +
          (usage.status === "occupied"
            ? dbMoneyToBigInt(usage.amountCents, "垫资额度占用金额")
            : 0n),
        used:
          totals.used +
          (usage.status === "used"
            ? dbMoneyToBigInt(usage.amountCents, "垫资额度使用金额")
            : 0n)
      }),
      { occupied: 0n, used: 0n }
    );
  }

  private async moveFinancingQuotaUsage(
    tx: Prisma.TransactionClient,
    paymentRequestId: string,
    amountCents: bigint | undefined,
    status: "released" | "used"
  ) {
    let remaining = amountCents;
    let moved = 0n;
    const occupiedUsages = await tx.projectFinancingQuotaUsage.findMany({
      where: { paymentRequestId, status: "occupied" },
      select: {
        id: true,
        quotaId: true,
        projectId: true,
        amountCents: true
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    for (const usage of occupiedUsages) {
      if (remaining !== undefined && remaining <= 0n) {
        break;
      }

      const available = dbMoneyToBigInt(usage.amountCents, "垫资额度占用金额");
      const amount = remaining === undefined || available <= remaining ? available : remaining;
      if (amount <= 0n) {
        continue;
      }

      if (amount === available) {
        await tx.projectFinancingQuotaUsage.update({
          where: { id: usage.id },
          data: { status }
        });
      } else {
        await tx.projectFinancingQuotaUsage.update({
          where: { id: usage.id },
          data: { amountCents: available - amount }
        });
        await tx.projectFinancingQuotaUsage.create({
          data: {
            quotaId: usage.quotaId,
            paymentRequestId,
            projectId: usage.projectId,
            amountCents: amount,
            status
          }
        });
      }

      moved += amount;
      if (remaining !== undefined) {
        remaining -= amount;
      }
    }

    return moved;
  }

  private async sumProjectProxyPaymentCents(
    tx: Prisma.TransactionClient,
    settlementId: string
  ): Promise<bigint> {
    const projectProxyPaymentClient = (tx as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: { settlementId: string; voidedAt: null };
          select: { amountCents: true };
        }) => Promise<Array<{ amountCents: bigint }>>;
      };
    }).projectProxyPayment;

    if (!projectProxyPaymentClient) {
      return 0n;
    }

    const payments = await projectProxyPaymentClient.findMany({
      where: { settlementId, voidedAt: null },
      select: { amountCents: true }
    });

    return sumMoneyCents(payments.map((payment) => payment.amountCents)) + await contractProxyPaid(tx, `settlement:${settlementId}`);
  }

  private async sumProjectProxyPaymentCentsForContract(
    tx: Prisma.TransactionClient,
    contractId: string,
    settlementIds: string[]
  ): Promise<bigint> {
    const projectProxyPaymentClient = (tx as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: {
            voidedAt: null;
            OR: Array<{ contractId: string } | { settlementId: { in: string[] } }>;
          };
          select: { amountCents: true };
        }) => Promise<Array<{ amountCents: bigint }>>;
      };
    }).projectProxyPayment;

    if (!projectProxyPaymentClient) {
      return 0n;
    }

    const payments = await projectProxyPaymentClient.findMany({
      where: {
        voidedAt: null,
        OR: [{ contractId }, { settlementId: { in: settlementIds } }]
      },
      select: { amountCents: true }
    });

    return sumMoneyCents(payments.map((payment) => payment.amountCents)) + await contractProxyPaidForContract(tx, contractId);
  }

  private async sumContractDueAllocatedCentsForSettlement(
    tx: Prisma.TransactionClient,
    settlementId: string
  ): Promise<bigint> {
    const allocationClient = (tx as unknown as {
      paymentExecutionAllocation?: {
        findMany: (args: {
          where: {
            settlementId: string;
            allocationType: { in: string[] };
          };
          select: { amountCents: true };
        }) => Promise<Array<{ amountCents: bigint }>>;
      };
    }).paymentExecutionAllocation;

    if (!allocationClient) {
      return 0n;
    }

    const allocations = await allocationClient.findMany({
      where: {
        settlementId,
        allocationType: { in: ["contract_due_payment", "advance_deduction"] }
      },
      select: { amountCents: true }
    });

    return sumMoneyCents(allocations.map((allocation) => allocation.amountCents));
  }

  private paymentRequestOutstandingCents(payment: {
    status: string;
    requestedAmountCents: bigint;
    approvedAmountCents: bigint | null;
    paidAmountCents: bigint;
  }): bigint {
    const payableAmountCents =
      ["approved_pending_payment", "partially_paid", "paid"].includes(payment.status)
        ? (payment.approvedAmountCents ?? payment.requestedAmountCents)
        : payment.requestedAmountCents;

    const outstanding = payableAmountCents - payment.paidAmountCents;
    return outstanding > 0n ? outstanding : 0n;
  }

  private async lockPaymentRequestForUpdate(
    tx: Prisma.TransactionClient,
    paymentId: string
  ): Promise<PaymentExecutionLockRow | null> {
    const rows = await tx.$queryRaw<Array<PaymentExecutionLockRow>>(Prisma.sql`
      SELECT
        payment."id",
        payment."code",
        payment."projectId",
        payment."contractId",
        contract."contractTypeKey",
        payment."contractVersionId",
        payment."paymentTermsVersionId",
        payment."paymentTermsStageId", payment."contractDueBasis",
        payment."settlementId", payment."signedSettlementId",
        payment."sourceType",
        payment."updatedAt",
        payment."paymentSubjectType",
        payment."status",
        payment."requestedAmountCents",
        payment."approvedAmountCents",
        payment."paidAmountCents",
        payment."remainingWithdrawnCents",
        version."signingSubjectType",
        version."companyEntityIdSnapshot",
        version."companyEntityNameSnapshot",
        version."companyEntityCreditCodeSnapshot",
        version."companyEntityVersionId",
        company."isActive" AS "companyDirectoryIsActive",
        version."status" AS "contractVersionStatus",
        contract."projectId" AS "contractProjectId"
      FROM "PaymentRequest" payment
      INNER JOIN "ContractVersion" version
        ON version."id" = payment."contractVersionId" AND version."contractId" = payment."contractId"
      INNER JOIN "Contract" contract
        ON contract."id" = payment."contractId"
      INNER JOIN "CompanyEntity" company
        ON company."id" = version."companyEntityIdSnapshot"
      WHERE payment."id" = ${paymentId} OR payment."code" = ${paymentId}
      LIMIT 1
      FOR UPDATE OF payment, version
    `);
    return rows[0] ?? null;
  }

  private async assertCurrentProjectFinanceStaff(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<void> {
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) {
      throw new ForbiddenException("当前付款登记账号不存在或已停用");
    }

    const [projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionId: true }
      }),
      tx.projectMember.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionKey: true }
      })
    ]);
    const positionIds = [...new Set(projectPositions.map((row) => row.positionId))];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const hasProjectFinanceRole =
      projectMembers.some((row) => row.positionKey === "finance_staff") ||
      positions.some((row) => row.key === "finance_staff");
    if (!hasProjectFinanceRole) {
      throw new ForbiddenException("只有当前项目财务人员可以登记实际付款");
    }
  }

  private async lockSettlementForPaymentExecution(
    tx: Prisma.TransactionClient,
    settlementId: string
  ): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Settlement"
      WHERE "id" = ${settlementId}
      FOR UPDATE
    `);
  }

  async withdrawApproval(paymentId: string, actorUserId: string, expectedApprovalInstanceId?: string) {
    if (!this.prisma) {
      throw new Error("付款审批撤回服务暂不可用，请稍后重试或联系管理员");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentRequestForUpdate(tx, paymentId);

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }
      if (payment.status !== "approval_pending") {
        throw new Error("当前付款申请已离开审批中，不能撤回");
      }

      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ApprovalInstance"
        WHERE "businessType" = 'payment_request' AND "businessId" = ${payment.id}
          AND "flowType" = 'payment.approve' AND "status" = 'in_progress'
        FOR UPDATE
      `);
      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          flowType: "payment.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的付款审批，请刷新后重试");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("只有付款申请人可以撤回审批");
      }

      const parallel = isOrdinaryPaymentParallelRound(instance.frozenNodes);
      if (!parallel && hasOrdinaryPaymentParallelMarker(instance.frozenNodes)) {
        throw new ConflictException("付款审批职责记录无效，不能撤回");
      }
      if (parallel && instance.id !== expectedApprovalInstanceId) {
        throw new ConflictException("付款审批轮次已变化，请刷新详情后重新确认撤回");
      }
      const nextStatus = parallel ? "draft" : "withdrawn";
      const updated = await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { status: nextStatus }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { status: "withdrawn" }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "withdraw",
          actorUserId
        }
      });

      await this.releaseFinancingQuotaUsage(
        tx,
        payment.id,
        actorUserId,
        "payment.financing_quota.release.withdraw"
      );

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.approval.withdraw",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          fromStatus: payment.status,
          toStatus: nextStatus,
          applicantUserId: instance.applicantUserId
        }
      });

      return updated;
    });
  }

  async abandonReturnedRequest(
    paymentId: string,
    actorUserId: string,
    input: AbandonPaymentRequestDto
  ) {
    if (!this.prisma) {
      throw new Error("付款申请放弃服务暂不可用，请稍后重试或联系管理员");
    }

    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException("放弃原因不能为空");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentRequestForUpdate(tx, paymentId);
      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      const current = await tx.paymentRequest.findUnique({ where: { id: payment.id } });
      if (!current) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }
      if (current.status === "abandoned") {
        if (current.abandonedByUserId !== actorUserId) {
          throw new ForbiddenException("只有当前付款申请人可以查看放弃结果");
        }
        return paymentPostResponseToApi(current);
      }
      if (current.status !== "draft") {
        throw new ConflictException("当前付款申请不是退回待修改状态，不能放弃申请");
      }
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("付款申请已被更新，请刷新后重试");
      }

      const approvalRows = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        applicantUserId: string;
        frozenNodes: unknown;
      }>>(Prisma.sql`
        SELECT "id", "status", "applicantUserId", "frozenNodes"
        FROM "ApprovalInstance"
        WHERE "businessType" = 'payment_request'
          AND "businessId" = ${payment.id}
          AND "flowType" = 'payment.approve'
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 1
        FOR UPDATE
      `);
      const latestApproval = approvalRows[0];
      const revisionAction = paymentRevisionAction(latestApproval);
      if (!latestApproval || !revisionAction) {
        throw new ConflictException("付款申请没有有效的退回待修改审批记录，不能放弃申请");
      }
      if (latestApproval.applicantUserId !== actorUserId) {
        throw new ForbiddenException("只有当前付款申请人可以放弃申请");
      }

      const returnAction = await tx.approvalActionLog.findFirst({
        where: {
          approvalInstanceId: latestApproval.id,
          action: revisionAction,
          ...(revisionAction === "withdraw" ? { actorUserId: latestApproval.applicantUserId } : {})
        },
        select: { id: true }
      });
      if (!returnAction) {
        throw new ConflictException("付款申请缺少退回审批动作记录，不能放弃申请");
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "PaymentExecution"
        WHERE "paymentRequestId" = ${payment.id}
        FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ProjectFinancingQuotaUsage"
        WHERE "paymentRequestId" = ${payment.id}
        FOR UPDATE
      `);

      const [executionCount, allocationCount, financeRecordCount, pdfArchiveCount, archiveCount] =
        await Promise.all([
          tx.paymentExecution.count({ where: { paymentRequestId: payment.id } }),
          tx.paymentExecutionAllocation.count({ where: { paymentRequestId: payment.id } }),
          tx.financeRecord.count({ where: { paymentRequestId: payment.id } }),
          tx.pdfDocument.count({
            where: { businessType: "payment_request", businessId: payment.id }
          }),
          tx.archiveRecord.count({
            where: { businessType: "payment_request", businessId: payment.id }
          })
        ]);
      if (executionCount > 0) {
        throw new ConflictException("付款申请已有实际付款或付款凭证，不能放弃申请");
      }
      if (allocationCount > 0) {
        throw new ConflictException("付款申请已有实付分摊记录，不能放弃申请");
      }
      if (financeRecordCount > 0) {
        throw new ConflictException("付款申请已有财务入账记录，不能放弃申请");
      }
      if (pdfArchiveCount > 0) {
        throw new ConflictException("付款申请已有 PDF 归档，不能放弃申请");
      }
      if (archiveCount > 0) {
        throw new ConflictException("付款申请已有业务归档记录，不能放弃申请");
      }
      if (dbMoneyToBigInt(payment.paidAmountCents, "付款实付金额") > 0n) {
        throw new ConflictException("付款申请已有实付金额，不能放弃申请");
      }
      const occupiedBefore = await this.financingUsageTotals(tx, payment.id);
      if (occupiedBefore.used > 0n) {
        throw new ConflictException("付款申请已有融资额度转为实付使用，不能放弃申请");
      }

      const updated = await tx.paymentRequest.updateMany({
        where: {
          id: payment.id,
          status: "draft",
          updatedAt: expectedUpdatedAt,
          abandonedAt: null
        },
        data: {
          status: "abandoned",
          abandonedAt: new Date(),
          abandonedByUserId: actorUserId,
          abandonReason: reason
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException("付款申请已被更新，请刷新后重试");
      }

      if (occupiedBefore.occupied > 0n) {
        await this.releaseFinancingQuotaUsage(
          tx,
          payment.id,
          actorUserId,
          "payment.financing_quota.release.abandonment"
        );
      }

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: latestApproval.id,
          action: "abandon_application",
          actorUserId,
          comment: reason
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.request.abandon",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          fromStatus: "draft",
          toStatus: "abandoned",
          approvalInstanceId: latestApproval.id,
          reason,
          residualOccupiedAmountCents: occupiedBefore.occupied.toString()
        }
      });

      const abandoned = await tx.paymentRequest.findUnique({ where: { id: payment.id } });
      if (!abandoned) {
        throw new Error("付款申请放弃结果未找到，请刷新付款台账后重试");
      }
      return paymentPostResponseToApi(abandoned);
    });
  }

  // 超时催办：申请人督促当前冻结节点（董事长/总经理）处理；超时/重复节流由 shared-domain 判定。
  async remindApproval(paymentId: string, actorUserId: string, now: Date = new Date()) {
    if (!this.prisma) {
      throw new Error("付款审批催办服务暂不可用，请稍后重试或联系管理员");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      if (payment.status !== "approval_pending") {
        throw new Error("当前付款申请已离开审批中，不能催办");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          flowType: "payment.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的付款审批，请刷新后重试");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("只有付款申请人可以催办审批");
      }

      const lastRemind = await tx.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id, action: "remind" },
        orderBy: { createdAt: "desc" }
      });

      // 催办不改写实例（不影响 updatedAt），仅记动作日志；超时与重复节流见 shared-domain。
      if (
        !canRemindApproval({
          status: instance.status,
          lastActivityAt: instance.updatedAt,
          lastRemindedAt: lastRemind?.createdAt ?? null,
          now
        })
      ) {
        throw new Error("当前付款审批还未达到催办时间，请稍后再试");
      }

      const nodes = instance.frozenNodes as unknown as Array<{ name: string }>;
      const currentNode = nodes[instance.currentNodeIndex];

      const log = await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "remind",
          actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.approval.remind",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          approvalInstanceId: instance.id,
          currentNodeIndex: instance.currentNodeIndex,
          nodeName: currentNode?.name,
          overdueHours: Math.floor(approvalElapsedHours(instance.updatedAt, now))
        }
      });

      return log;
    });
  }

  /** Internal operation for the cutover runner while ordinary payment writes are stopped. */
  migrateLegacyApprovalRound(paymentId: string, actorUserId: string, expected: {
    approvalInstanceId: string;
    paymentUpdatedAt: Date;
    approvalUpdatedAt: Date;
  }) {
    if (!this.writeFreeze.isFrozen("payment")) {
      throw new ConflictException("请先暂停普通付款写入，再切换在途审批");
    }
    if (!this.prisma || !this.files || !this.approvalNotifications) {
      throw new ConflictException("普通付款审批切换服务暂不可用");
    }
    const { files, approvalNotifications } = this;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PaymentRequest" WHERE id = ${paymentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ApprovalInstance" WHERE "businessType" = 'payment_request'
        AND "businessId" = ${paymentId} AND "flowType" = 'payment.approve' AND status = 'in_progress' FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
      if (!actor?.isActive) throw new ForbiddenException("付款审批切换经办人不存在或已停用");
      const payment = await tx.paymentRequest.findUnique({ where: { id: paymentId } });
      if (!payment || payment.status !== "approval_pending" || !hasPaymentRevisionBasis(payment) ||
          await tx.paymentExecution.findFirst({ where: { paymentRequestId: paymentId }, select: { id: true } })) {
        throw new ConflictException("只有可退回重提且尚未实付的普通付款可切换审批");
      }
      const active = await tx.approvalInstance.findMany({
        where: { businessType: "payment_request", businessId: paymentId, flowType: "payment.approve", status: "in_progress" }, take: 2
      });
      if (active.length !== 1) throw new ConflictException("在途普通付款审批轮次不唯一");
      const current = active[0];
      const stale = () => new ConflictException("付款审批轮次已变化，请重新盘点");
      if (current.id !== expected.approvalInstanceId || payment.updatedAt.getTime() !== expected.paymentUpdatedAt.getTime()) {
        throw stale();
      }
      const evidence = {
        approvalInstanceId: expected.approvalInstanceId,
        paymentUpdatedAt: expected.paymentUpdatedAt.toISOString(),
        approvalUpdatedAt: expected.approvalUpdatedAt.toISOString()
      };
      if (isOrdinaryPaymentParallelRound(current.frozenNodes)) {
        const prior = await tx.auditLog.findFirst({ where: {
          actorUserId, businessType: "payment_request", businessId: payment.id, action: "payment.approval.legacy_cutover",
          AND: Object.entries({ ...evidence, mappedApprovalUpdatedAt: current.updatedAt.toISOString() })
            .map(([key, value]) => ({ metadata: { path: [key], equals: value } }))
        }, select: { id: true } });
        if (!prior) throw stale();
        return { status: "already_mapped" as const };
      }
      if (current.updatedAt.getTime() !== expected.approvalUpdatedAt.getTime()) throw stale();
      const { plan, round } = await inspectPaymentApprovalHistory(tx, files, paymentId);
      const oldNodes = round.frozenNodes as Array<Record<string, unknown>>;
      if (oldNodes.some(node => (node.roleKeys as RoleKey[]).some(role => !canPerform("payment.approve", [role])))) {
        throw new ConflictException("原付款职责含无付款审批权限的岗位，请核对原轮次");
      }
      if (oldNodes.slice(round.currentNodeIndex).some(duty => Array.isArray(duty.assignments) &&
          duty.assignments.some(assignment => assignment?.kind === "delegate"))) {
        throw new ConflictException("原付款审批委托没有冻结有效期，请核对原委托后再切换");
      }
      const frozenNodes = ordinaryPaymentParallelNodes(oldNodes).map((node, index) => ({
        ...node,
        ...(index === round.currentNodeIndex ? { legacyPaymentNoticeRevision: round.updatedAt.toISOString() } : {}),
        ...(plan.completedActionIds[index] ? { legacyPaymentApprovalActionId: plan.completedActionIds[index] } : {})
      }));
      const migrated = await tx.approvalInstance.update({
        where: { id: round.id }, data: { frozenNodes: frozenNodes as Prisma.InputJsonValue }
      });
      await approvalNotifications.queue(tx, payment, migrated, null);
      const pendingNodeIndexes = plan.pendingDuties.map(duty => duty.nodeIndex);
      await this.audit.record(tx, {
        actorUserId, businessType: "payment_request", businessId: payment.id, action: "payment.approval.legacy_cutover",
        metadata: { ...evidence, mappedApprovalUpdatedAt: migrated.updatedAt.toISOString(),
          completedActionIds: plan.completedActionIds, pendingNodeIndexes }
      });
      return { status: "mapped" as const, pendingNodeIndexes };
    });
  }

  async reviewApproval(
    paymentId: string,
    actorUserId: string,
    input: ReviewPaymentApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("付款审批服务暂不可用，请稍后重试或联系管理员");
    }
    if (
      !["approve", "reject", "reject_previous", "return_to_applicant"].includes(
        input.decision
      )
    ) {
      throw new Error("不支持的付款审批处理方式");
    }
    requireApprovalCommentForReturn(input.decision, input.comment);
    const expectedPaymentUpdatedAt = new Date(input.expectedPaymentUpdatedAt);
    const expectedApprovalUpdatedAt = new Date(input.expectedApprovalUpdatedAt);
    if (Number.isNaN(expectedPaymentUpdatedAt.getTime())) {
      throw new BadRequestException("预期付款申请版本格式不正确");
    }
    if (Number.isNaN(expectedApprovalUpdatedAt.getTime())) {
      throw new BadRequestException("预期审批版本格式不正确");
    }

    let completedInstanceId: string | undefined;
    let correctionQueued = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const lockedPayment = supportsApprovalReviewLock(tx)
        ? await this.lockPaymentRequestForUpdate(tx, paymentId)
        : null;
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      if (payment.status !== "approval_pending") {
        throw new ConflictException("当前付款申请已离开审批中，不能处理审批");
      }

      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ApprovalInstance"
        WHERE "businessType" = 'payment_request'
          AND "businessId" = ${payment.id}
          AND "flowType" = 'payment.approve'
          AND "status" = 'in_progress'
        FOR UPDATE
      `);

      const approvalWhere = {
        businessType: "payment_request",
        businessId: payment.id,
        flowType: "payment.approve",
        status: "in_progress"
      } as const;
      const approvalClient = tx.approvalInstance as typeof tx.approvalInstance & {
        findMany?: typeof tx.approvalInstance.findMany;
      };
      const instances = approvalClient.findMany
        ? await approvalClient.findMany({
            where: approvalWhere,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 2
          })
        : [await tx.approvalInstance.findFirst({ where: approvalWhere })].filter(
            (item): item is NonNullable<typeof item> => item !== null
          );

      if (instances.length === 0) {
        throw new ConflictException("未找到进行中的付款审批，请刷新后重试");
      }
      if (instances.length !== 1) {
        throw new ConflictException("付款审批实例异常，请刷新页面后重试");
      }
      const instance = instances[0];

      const nodes = instance.frozenNodes as unknown as PaymentApprovalNode[];
      const parallel = isOrdinaryPaymentParallelRound(instance.frozenNodes);
      if (hasOrdinaryPaymentParallelMarker(instance.frozenNodes) && !parallel) {
        throw new ConflictException("付款审批职责版本无法识别，请核对原审批记录");
      }
      const nodeIndex = parallel ? input.expectedNodeIndex : instance.currentNodeIndex;
      if (parallel) {
        if (!activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex).includes(nodeIndex)) {
          throw new ForbiddenException("该付款审批职责已办理或不在当前轮次");
        }
        if (input.decision === "reject_previous") {
          throw new BadRequestException("并联审批只能退回原申请人修改");
        }
        if (input.approvedAmountCents !== undefined) {
          throw new BadRequestException("付款审批中不能修改金额，请退回原申请人修改后重提");
        }
      }
      const currentNode = nodes[nodeIndex];

      if (!currentNode) {
        throw new Error("当前付款审批节点异常，请刷新后重试");
      }

      const actorRoleScopes = parallel ? await this.loadActorRoleScopes(tx, actorUserId, payment.projectId) : undefined;
      const actorRoleKeys = actorRoleScopes
        ? resolveEffectiveRoleKeys(actorRoleScopes.globalRoleKeys, actorRoleScopes.projectRoleKeys)
        : await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      const identityNode = input.decision === "approve"
        ? currentNode
        : { ...currentNode, approvedRoleKeys: [] };
      const delegationPrincipals = parallel
        ? await loadOrdinaryPaymentDelegationPrincipals(tx, instance.frozenNodes, actorUserId, payment.projectId,
          id => this.loadActorRoleScopes(tx, id, payment.projectId), { dutyIndex: nodeIndex, lock: true })
        : undefined;
      const directIdentity = { actorUserId, actorRoleKeys, actorRoleScopes, delegationPrincipals };
      let identity = parallel ? resolveOrdinaryPaymentDuty(instance.frozenNodes, nodeIndex, directIdentity)
        : resolveApprovalReviewIdentity({ node: identityNode, ...directIdentity });
      if (!identity) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async userId => {
          const roleScopes = parallel ? await this.loadActorRoleScopes(tx, userId, payment.projectId) : undefined;
          const roleKeys = roleScopes ? resolveEffectiveRoleKeys(roleScopes.globalRoleKeys, roleScopes.projectRoleKeys)
            : await this.loadActorRoleKeys(tx, userId, payment.projectId);
          return { userId, roleKeys, roleScopes };
        }));
        identity = parallel ? resolveOrdinaryPaymentDuty(instance.frozenNodes, nodeIndex, { ...directIdentity, activeDelegators })
          : resolveApprovalReviewIdentity({ node: identityNode, ...directIdentity, activeDelegators });
      }
      if (!identity) {
        throw new ForbiddenException(`当前账号不能处理“${currentNode.name}”付款审批节点`);
      }
      const approvedRoleKey = identity.approvedRoleKey;
      const delegationMetadata = "ordinaryPaymentDelegationActionId" in identity &&
        typeof identity.ordinaryPaymentDelegationActionId === "string"
        ? { ordinaryPaymentDelegationActionId: identity.ordinaryPaymentDelegationActionId, ordinaryPaymentDutyIndex: nodeIndex }
        : undefined;

      const selfReview = await confirmApprovalSelfReview({
        applicantUserId: instance.applicantUserId,
        actorUserId,
        actorRoleKeys: identity.representedUserId === actorUserId &&
          !identity.viaAssignment
          ? Array.from(new Set([...actorRoleKeys, approvedRoleKey]))
          : actorRoleKeys,
        approvedRoleKey,
        representedUserId: identity.representedUserId,
        viaAssignment: identity.viaAssignment,
        selfReviewReason: input.selfReviewReason,
        confirmationPassword: input.confirmationPassword,
        confirmPassword: this.auth
          ? (password) => this.auth!.confirmPassword(actorUserId, password)
          : undefined
      });

      if (
        !(payment.updatedAt instanceof Date) ||
        payment.updatedAt.getTime() !== expectedPaymentUpdatedAt.getTime() ||
        input.expectedApprovalInstanceId !== instance.id ||
        input.expectedNodeIndex !== nodeIndex ||
        !(instance.updatedAt instanceof Date) ||
        instance.updatedAt.getTime() !== expectedApprovalUpdatedAt.getTime()
      ) {
        throw new ConflictException("付款审批坐标已变化，请刷新页面后重试");
      }

      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: input.decision === "approve"
      });

      if (input.decision === "reject_previous") {
        if (instance.currentNodeIndex === 0) {
          throw new Error("当前已经是第一个审批节点，不能退回上一节点");
        }

        const previousNodeIndex = instance.currentNodeIndex - 1;
        const nextNodes = nodes.map((node, index) =>
          index === previousNodeIndex || index === instance.currentNodeIndex
            ? { ...node, approvedRoleKeys: [] }
            : node
        );
        const updated = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: { status: "approval_pending" }
        });

        const nextRound = await tx.approvalInstance.update({
          where: { id: instance.id },
          data: {
            currentNodeIndex: previousNodeIndex,
            frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
            status: "in_progress"
          }
        });

        const transition = await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject_previous",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "payment.approval.reject_previous",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            fromStatus: payment.status,
            toStatus: "approval_pending",
            fromNodeName: currentNode.name,
            toNodeName: nextNodes[previousNodeIndex].name,
            approvedRoleKey,
            ...selfReview.metadata
          }
        });

        await this.approvalNotifications?.queue(tx, updated, nextRound, transition);
        return updated;
      }

      if (input.decision === "return_to_applicant" || (parallel && input.decision === "reject")) {
        const updated = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: { status: "draft" }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "returned_to_applicant" }
        });

        const returnedAction = await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "return_to_applicant",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview || delegationMetadata ? { metadata: { ...selfReview.metadata, ...delegationMetadata } } : {})
          }
        });

        await this.releaseFinancingQuotaUsage(
          tx,
          payment.id,
          actorUserId,
          "payment.financing_quota.release.return_to_applicant"
        );

        await this.audit.record(tx, {
          actorUserId,
          action: "payment.approval.return_to_applicant",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            fromStatus: payment.status,
            toStatus: "draft",
            nodeName: currentNode.name,
            approvedRoleKey,
            ...selfReview.metadata,
            ...delegationMetadata
          }
        });

        if (this.approvalNotifications) {
          // 退回修改后原申请人要改单重提，与审批待办共用同一入队/重试通道。
          await this.approvalNotifications.queueCorrection(tx, updated, { ...instance, status: "returned_to_applicant" }, returnedAction);
          correctionQueued = true;
        }

        return updated;
      }

      if (input.decision === "reject") {
        const rejected = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: {
            status: "approval_rejected",
            approvedAmountCents: null
          }
        });
        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "rejected" }
        });
        const rejectedAction = await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
          }
        });
        await this.releaseFinancingQuotaUsage(
          tx,
          payment.id,
          actorUserId,
          "payment.financing_quota.release.reject"
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "payment.approval.reject",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            fromStatus: payment.status,
            toStatus: "approval_rejected",
            nodeName: currentNode.name,
            approvedRoleKey,
            ...selfReview.metadata
          }
        });
        if (this.approvalNotifications) {
          await this.approvalNotifications.queueCorrection(tx, rejected, { ...instance, status: "rejected" }, rejectedAction);
          correctionQueued = true;
        }
        return rejected;
      }

      const requestedApprovedAmountCents =
        input.approvedAmountCents === undefined
          ? undefined
          : positiveMoneyCents(
              input.approvedAmountCents,
              "批准付款金额必须大于 0，请按元填写有效金额"
            );

      if (
        requestedApprovedAmountCents !== undefined &&
        requestedApprovedAmountCents > payment.requestedAmountCents
      ) {
        throw new Error(
          `批准付款金额不能超过申请金额，当前最多可批准 ${this.formatYuan(
            payment.requestedAmountCents
          )} 元`
        );
      }

      const nextNodes = [...nodes];
      const nextNode = { ...currentNode };
      const approvedRoleKeys = new Set(nextNode.approvedRoleKeys ?? []);
      approvedRoleKeys.add(approvedRoleKey);
      nextNode.approvedRoleKeys = [...approvedRoleKeys];
      nextNodes[nodeIndex] = nextNode;

      const nodeCompleted =
        nextNode.mode === "any" || nextNode.roleKeys.every((role) => approvedRoleKeys.has(role));
      const nextNodeIndex = parallel
        ? activeApprovalNodeIndexes(nextNodes, instance.currentNodeIndex)[0] ?? nextNodes.length
        : nodeCompleted ? instance.currentNodeIndex + 1 : instance.currentNodeIndex;
      const flowCompleted = nextNodeIndex >= nextNodes.length;
      const approvedAmountCents = requestedApprovedAmountCents ?? payment.requestedAmountCents;

      if (!flowCompleted && input.approvedAmountCents !== undefined) {
        throw new Error("只有最后一个付款审批节点才能调整批准金额");
      }
      const payerFacts = lockedPayment ??
        (payment as typeof payment & {
          signingSubjectType?: string;
          companyEntityIdSnapshot?: string | null;
          companyEntityNameSnapshot?: string | null;
          companyEntityCreditCodeSnapshot?: string | null;
        });
      if (
        flowCompleted &&
        (payerFacts.paymentSubjectType === "affiliate"
          ? payerFacts.signingSubjectType !== "affiliate"
          : payerFacts.paymentSubjectType !== "our_company" ||
            payerFacts.signingSubjectType !== "our_company" ||
            !payerFacts.companyEntityIdSnapshot?.trim() ||
            !payerFacts.companyEntityNameSnapshot?.trim() ||
            !payerFacts.companyEntityCreditCodeSnapshot?.trim())
      ) {
        throw new BadRequestException(
          payerFacts.paymentSubjectType === "affiliate"
            ? "施工企业付款申请必须关联施工企业签约合同"
            : "付款合同不是完整的我方付款主体，不能完成付款审批"
        );
      }

      if (flowCompleted && payment.sourceType === "signed_settlement") {
        await this.assertSignedSettlementApprovalCapacity(
          tx,
          payment,
          approvedAmountCents,
          actorUserId
        );
      }

      if (flowCompleted && payerFacts.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS) {
        await this.assertTextAgreementCapacity(tx, payment, approvedAmountCents);
      }

      const approved = await tx.paymentRequest.update({
        where: { id: payment.id },
        data: flowCompleted
          ? {
              status: "approved_pending_payment",
              approvedAmountCents
            }
          : { status: "approval_pending" }
      });
      const nextRound = await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: nextNodeIndex,
          frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
          status: flowCompleted ? "approved" : "in_progress"
        }
      });
      const finalApprovalAction = await tx.approvalActionLog.create({
        data: await withApprovalIdentity(tx, {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          comment: input.comment?.trim() || undefined,
          approvedRoleKey,
          representedUserId: identity.representedUserId,
          signatureFileIdSnapshot: signature.fileId,
          signatureSha256Snapshot: signature.sha256,
          signatureVersionIdSnapshot: signature.versionId,
          ...(parallel || selfReview.isSelfReview ? { metadata: {
            ...(parallel ? { ordinaryPaymentDutyIndex: nodeIndex } : {}),
            ...delegationMetadata,
            ...(selfReview.isSelfReview ? selfReview.metadata : {})
          } } : {})
        }, signature)
      });
      if (!parallel && !flowCompleted && nodeCompleted) {
        await this.approvalNotifications?.queue(tx, approved, nextRound, finalApprovalAction);
      }
      if (flowCompleted && payerFacts.paymentSubjectType === "our_company") {
        await queueApprovedRegisteredPaymentNotifications(tx, payment.id, instance.id, finalApprovalAction);
      }
      if (flowCompleted) {
        await this.shrinkFinancingQuotaUsageToApprovedAmount(
          tx,
          payment,
          approvedAmountCents,
          actorUserId
        );
        if (this.businessEntry) {
          const businessEntrySnapshot = parallel
            ? await this.businessEntry.freezeFinalOrdinaryPaymentAmountInTransaction(
              tx, actorUserId, payment.projectId, payment.id, approvedAmountCents
            )
            : await this.businessEntry.freezeSubmissionSnapshotInTransaction(tx, actorUserId, {
              sceneKey: "payment_approval_amount",
              definitionVersion: 1,
              target: {
                projectId: payment.projectId,
                entityType: "payment_request",
                entityId: payment.id
              },
              values: paymentApprovalAmountEntryValues(approvedAmountCents)
            });
          Object.assign(approved, { businessEntrySnapshot });
        }
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.approval.approve",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code,
          fromStatus: payment.status,
          toStatus: flowCompleted ? "approved_pending_payment" : "approval_pending",
          requestedAmountCents: moneyCentsToApi(payment.requestedAmountCents),
          approvedAmountCents: flowCompleted ? moneyCentsToApi(approvedAmountCents) : undefined,
          nodeName: currentNode.name,
          approvedRoleKey,
          nodeCompleted,
          ...selfReview.metadata,
          ...delegationMetadata
        }
      });
      if (flowCompleted) {
        completedInstanceId = instance.id;
      }
      return approved;
    });

    if (result.status === "approval_pending" || correctionQueued) await this.approvalNotifications?.afterCommit(result.id);
    if (completedInstanceId) {
      // Approval is already committed. Notification failure cannot turn this
      // result into an apparent failed approval or repeat the business action.
      await this.registeredNotifications?.dispatchQueued(result.id).catch(() => {
        Logger.warn("付款已批准，定向办理通知的派发结果仍待核验", "PaymentRequestService");
      });
      await this.approvalForms
        ?.generateForInstance(completedInstanceId, actorUserId)
        .catch(() => undefined);
    }

    return result;
  }

  transferApproval(paymentId: string, actorUserId: string, input: AssignPaymentApprovalDto) {
    return this.assignApproval("transfer", paymentId, actorUserId, input);
  }

  delegateApproval(paymentId: string, actorUserId: string, input: DelegatePaymentApprovalDto) {
    return this.assignApproval("delegate", paymentId, actorUserId, input);
  }

  private async createContractDuePaymentExecutionAllocations(
    tx: Prisma.TransactionClient,
    payment: PaymentExecutionLockRow,
    paymentExecutionId: string,
    amountCents: bigint,
    paidAt: Date,
    actorUserId: string
  ): Promise<void> {
    if (payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS) {
      await tx.$executeRaw`SELECT public.jg_append_text_payment_allocation_v1(${paymentExecutionId}::text)`;
      return;
    }
    if (payment.paymentTermsStageId && payment.paymentTermsVersionId) {
      const [contractVersion, stage] = await Promise.all([
        tx.contractVersion.findUnique({
          where: { id: payment.contractVersionId },
          select: { id: true, amountCents: true, effectiveAt: true }
        }),
        tx.paymentTermsStage.findUnique({
          where: { id: payment.paymentTermsStageId },
          select: {
            id: true,
            paymentTermsVersionId: true,
            name: true,
            stageType: true,
            basis: true,
            ratioBps: true,
            fixedAmountCents: true,
            triggerAnchor: true,
            dueDays: true
          }
        })
      ]);

      if (!contractVersion || !contractVersion.effectiveAt) {
        throw new BadRequestException("合同生效事实缺失，不能登记实付");
      }
      this.assertGenericContractPaymentStage(stage, payment.paymentTermsVersionId);

      const contractAmountCents = dbMoneyToBigInt(contractVersion.amountCents, "合同金额");
      const configuredAmountCents = stage!.fixedAmountCents !== null
        ? dbMoneyToBigInt(stage!.fixedAmountCents, "付款阶段固定金额")
        : (contractAmountCents * BigInt(Math.max(stage!.ratioBps ?? 0, 0))) / 10000n;
      const sourcePayableAmountCents = configuredAmountCents < contractAmountCents
        ? configuredAmountCents
        : contractAmountCents;
      const expectedPayableAt = new Date(
        contractVersion.effectiveAt.getTime() + Math.max(stage!.dueDays, 0) * 24 * 60 * 60 * 1000
      );

      await tx.paymentExecutionAllocation.createMany({
        data: [{
          paymentExecutionId,
          paymentRequestId: payment.id,
          projectId: payment.projectId,
          contractId: payment.contractId,
          contractVersionId: contractVersion.id,
          settlementId: null,
          sourceType: "contract_due",
          allocationType: "contract_due_payment",
          sourceRowId: `contract:${payment.paymentTermsVersionId}:${stage!.id}`,
          paymentTermsVersionId: payment.paymentTermsVersionId,
          stageType: stage!.stageType,
          stageId: stage!.id,
          stageName: stage!.name,
          triggerAnchor: stage!.triggerAnchor,
          dueDays: stage!.dueDays,
          ratioBps: stage!.ratioBps,
          fixedAmountCents: stage!.fixedAmountCents,
          sourceEffectiveAt: contractVersion.effectiveAt,
          expectedPayableAt,
          sourcePayableAmountCents,
          amountCents,
          allocationOrder: 0,
          createdByUserId: actorUserId
        }]
      });
      return;
    }

    const contractSettlements = await tx.settlement.findMany({
      where: {
        contractId: payment.contractId,
        status: { in: [...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES] }
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
        paidAmountCents: true,
        contractVersionId: true,
        paymentTermsVersionId: true,
        isFinal: true,
        sourceType: true,
        sourceTakeoverId: true
      }
    });
    const settlementIds = contractSettlements.map((settlement) => settlement.id);
    const historicalBalance = await this.confirmedHistoricalBalanceForContract(
      tx,
      payment.contractId
    );
    const paymentTermsVersionIds = [
      ...new Set([
        ...contractSettlements.map((settlement) => settlement.paymentTermsVersionId),
        ...(historicalBalance?.paymentTermsVersionId ? [historicalBalance.paymentTermsVersionId] : [])
      ])
    ];

    if (!settlementIds.length || !paymentTermsVersionIds.length) {
      throw new Error("未找到可分摊的有效结算来源，请先核对合同结算和历史期初结算");
    }

    const paymentRequestClient = tx.paymentRequest as unknown as {
      findMany: (args: {
        where: Record<string, unknown>;
        select: Record<string, boolean>;
      }) => Promise<Array<{
        id?: string;
        settlementId?: string | null;
        paymentTermsVersionId?: string | null;
        status: string;
        requestedAmountCents: bigint;
        approvedAmountCents: bigint | null;
        paidAmountCents: bigint;
      }>>;
    };
    const projectProxyPaymentClient = (tx as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: Record<string, unknown>;
          select: Record<string, boolean>;
        }) => Promise<Array<{ settlementId: string | null; amountCents: bigint }>>;
      };
    }).projectProxyPayment;

    const [
      paymentTermsStages,
      settlementArchiveFiles,
      existingAllocations,
      contractDuePaidRequests,
      settlementPaymentRequests,
      advancePaymentRequests,
      projectProxyPayments,
      contractAmountCentsByPaymentTermsVersionId
    ] = await Promise.all([
      tx.paymentTermsStage.findMany({
        where: {
          paymentTermsVersionId: { in: paymentTermsVersionIds },
          OR: [{ basis: "current_settlement" }, { stageType: "advance" }]
        },
        select: {
          id: true,
          name: true,
          paymentTermsVersionId: true,
          stageType: true,
          basis: true,
          ratioBps: true,
          fixedAmountCents: true,
          triggerAnchor: true,
          dueDays: true,
          advanceDeductionMode: true,
          advanceDeductionRatioBps: true,
          advanceDeductionStartRatioBps: true
        }
      }),
      loadSettlementPaymentConfirmationFacts(tx, settlementIds),
      tx.paymentExecutionAllocation.findMany({
        where: {
          contractId: payment.contractId,
          allocationType: { in: ["contract_due_payment", "advance_deduction"] }
        },
        select: { paymentRequestId: true, allocationType: true, sourceRowId: true, amountCents: true }
      }),
      paymentRequestClient.findMany({
        where: {
          contractId: payment.contractId,
          sourceType: "contract_due",
          settlementId: null,
          paidAmountCents: { gt: 0 }
        },
        select: {
          id: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      paymentRequestClient.findMany({
        where: {
          contractId: payment.contractId,
          sourceType: "settlement",
          settlementId: { in: settlementIds },
          status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES] }
        },
        select: {
          settlementId: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      paymentRequestClient.findMany({
        where: {
          contractId: payment.contractId,
          sourceType: "contract_advance",
          paymentTermsVersionId: { in: paymentTermsVersionIds },
          paidAmountCents: { gt: 0 }
        },
        select: {
          paymentTermsVersionId: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      projectProxyPaymentClient
        ? projectProxyPaymentClient.findMany({
            where: {
              voidedAt: null,
              OR: [{ contractId: payment.contractId }, { settlementId: { in: settlementIds } }]
            },
            select: { settlementId: true, amountCents: true }
          })
        : Promise.resolve([]),
      this.contractAmountCentsByPaymentTermsVersionIdForCapacity(tx, contractSettlements)
    ]);

    const normalizedAdvancePaymentRequests = advancePaymentRequests.flatMap((request) =>
      request.paymentTermsVersionId
        ? [
            {
              paymentTermsVersionId: request.paymentTermsVersionId,
              status: request.status,
              requestedAmountCents: request.requestedAmountCents,
              approvedAmountCents: request.approvedAmountCents,
              paidAmountCents: request.paidAmountCents
            }
          ]
        : []
    );

    const preview = buildContractPaymentApplicationPreview({
      asOf: paidAt,
      settlements: contractSettlements,
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests: [],
      advancePaymentRequests: normalizedAdvancePaymentRequests,
      contractAmountCentsByPaymentTermsVersionId,
      historicalBalance
    });
    const existingConsumptionRows = existingAllocations.map((allocation) => ({
      sourceRowId: allocation.sourceRowId,
      amountCents: allocation.amountCents
    }));
    const registerSyntheticConsumption = (
      syntheticAmountCents: bigint,
      sections = preview.sections
    ) => {
      if (syntheticAmountCents <= 0n) return;
      const syntheticAllocations = allocateContractDuePaymentExecution({
        amountCents: syntheticAmountCents,
        sections,
        existingAllocations: existingConsumptionRows
      });
      existingConsumptionRows.push(
        ...syntheticAllocations.map((allocation) => ({
          sourceRowId: allocation.sourceRowId,
          amountCents: allocation.amountCents
        }))
      );
    };

    for (const settlement of contractSettlements) {
      if ((settlement.paidAmountCents ?? 0n) <= 0n) continue;
      registerSyntheticConsumption(
        settlement.paidAmountCents ?? 0n,
        this.contractDueSectionsForSettlement(preview.sections, settlement.id)
      );
    }

    for (const settlementPayment of settlementPaymentRequests) {
      if (!settlementPayment.settlementId) continue;

      registerSyntheticConsumption(
        this.paymentRequestOutstandingCents(settlementPayment),
        this.contractDueSectionsForSettlement(preview.sections, settlementPayment.settlementId)
      );
    }

    for (const proxyPayment of projectProxyPayments) {
      const syntheticAmountCents = sumMoneyCents([proxyPayment.amountCents]);
      registerSyntheticConsumption(
        syntheticAmountCents,
        proxyPayment.settlementId
          ? this.contractDueSectionsForSettlement(preview.sections, proxyPayment.settlementId)
          : preview.sections
      );
    }

    const allocatedCentsByPaymentRequestId = existingAllocations
      .filter((allocation) => allocation.allocationType === "contract_due_payment")
      .reduce<Map<string, bigint>>(
        (totals, allocation) => {
          totals.set(
            allocation.paymentRequestId,
            (totals.get(allocation.paymentRequestId) ?? 0n) + allocation.amountCents
          );
          return totals;
        },
        new Map()
      );
    for (const paidRequest of contractDuePaidRequests) {
      if (!paidRequest.id) continue;
      const residualPaidCents =
        paidRequest.paidAmountCents - (allocatedCentsByPaymentRequestId.get(paidRequest.id) ?? 0n);
      registerSyntheticConsumption(residualPaidCents);
    }
    const existingAdvanceDeductionCents = sumMoneyCents(
      existingAllocations
        .filter((allocation) => allocation.allocationType === "advance_deduction")
        .map((allocation) => allocation.amountCents)
    );
    const configuredAdvanceDeductionCents = parseMoneyCents(
      preview.advanceDeduction.currentDeductionCents,
      "本次预付款扣回金额"
    );
    const residualAdvanceDeductionCents =
      configuredAdvanceDeductionCents > existingAdvanceDeductionCents
        ? configuredAdvanceDeductionCents - existingAdvanceDeductionCents
        : 0n;
    const advanceDeductionAllocations =
      residualAdvanceDeductionCents > 0n
        ? allocateContractDuePaymentExecution({
            amountCents: residualAdvanceDeductionCents,
            sections: preview.sections,
            existingAllocations: existingConsumptionRows
          })
        : [];
    existingConsumptionRows.push(
      ...advanceDeductionAllocations.map((allocation) => ({
        sourceRowId: allocation.sourceRowId,
        amountCents: allocation.amountCents
      }))
    );

    const allocations = allocateContractDuePaymentExecution({
      amountCents,
      sections: preview.sections,
      existingAllocations: existingConsumptionRows
    });

    if (!advanceDeductionAllocations.length && !allocations.length) {
      return;
    }

    const toAllocationRows = (
      allocationType: "advance_deduction" | "contract_due_payment",
      allocationRows: typeof allocations,
      allocationOrderOffset: number
    ) =>
      allocationRows.map((allocation, index) => ({
        paymentExecutionId,
        paymentRequestId: payment.id,
        projectId: payment.projectId,
        contractId: payment.contractId,
        contractVersionId: allocation.contractVersionId,
        settlementId: allocation.settlementId,
        sourceType: "contract_due",
        allocationType,
        sourceRowId: allocation.sourceRowId,
        paymentTermsVersionId: allocation.paymentTermsVersionId,
        stageType: allocation.stageType,
        stageId: allocation.stageId,
        stageName: allocation.stageName,
        triggerAnchor: allocation.triggerAnchor,
        dueDays: allocation.dueDays,
        ratioBps: allocation.ratioBps,
        fixedAmountCents: allocation.fixedAmountCents,
        sourceEffectiveAt: allocation.sourceEffectiveAt,
        expectedPayableAt: allocation.expectedPayableAt,
        sourcePayableAmountCents: allocation.sourcePayableAmountCents,
        amountCents: allocation.amountCents,
        allocationOrder: allocationOrderOffset + index,
        createdByUserId: actorUserId
      }));

    await tx.paymentExecutionAllocation.createMany({
      data: [
        ...toAllocationRows("advance_deduction", advanceDeductionAllocations, 0),
        ...toAllocationRows(
          "contract_due_payment",
          allocations,
          advanceDeductionAllocations.length
        )
      ]
    });
  }

  private contractDueSectionsForSettlement(
    sections: ReturnType<typeof buildContractPaymentApplicationPreview>["sections"],
    settlementId: string
  ) {
    return sections
      .map((section) => ({
        ...section,
        rows: section.rows.filter((row) => row.settlementId === settlementId)
      }))
      .filter((section) => section.rows.length > 0);
  }

  async uploadRegisteredVoucherFile(executionId: string, actorUserId: string, input: {originalName:string;mimeType:string;sizeBytes:number;buffer:Buffer;idempotencyKey?:string}) {
    if (!this.prisma || !this.files) throw new BadRequestException("私有凭证服务暂不可用，请保留文件后重试");
    await this.prisma.$transaction(async tx=>{
      await assertRegisteredPaymentActor(tx,actorUserId);
      const funding = await tx.registeredPaymentFunding.findUnique({where:{executionId}});
      const execution = funding ? await tx.paymentExecution.findUnique({where:{id:executionId}}) : null;
      if (!execution || execution.voucherFileId !== null) throw new ConflictException("当前实付不属于可后补凭证的登记付款，请查询原记录");
    });
    return this.files.uploadPrivateFile({...input,uploadedByUserId:actorUserId});
  }

  async registeredVoucherTicket(executionId: string, actorUserId: string) {
    if (!this.prisma || !this.files) throw new BadRequestException("私有凭证服务暂不可用，请稍后重试");
    const prisma = this.prisma;
    const fileId = await prisma.$transaction(async tx=>{
      const funding = await tx.registeredPaymentFunding.findUnique({where:{executionId}});
      const execution = funding ? await tx.paymentExecution.findUnique({where:{id:executionId}}) : null;
      const payment = execution ? await tx.paymentRequest.findUnique({where:{id:execution.paymentRequestId}}) : null;
      if (!payment || !(await new ProjectVisibilityService(prisma).visibleProjectIdsInTransaction(tx,actorUserId)).includes(payment.projectId) ||
        !(await sensitiveBusinessReadAllowed(tx,"payment_request",payment.id,actorUserId,await this.loadActorRoleKeys(tx,actorUserId,payment.projectId)))) {
        throw new ForbiddenException("当前账号无权读取该付款凭证");
      }
      const voucher = await tx.registeredPaymentVoucher.findUnique({where:{executionId}});
      if (!voucher) throw new BadRequestException("该笔实付凭证尚待补充");
      return voucher.fileId;
    });
    return this.files.createDownloadTicket(fileId,{actorUserId,downloadReason:"实际付款凭证下载"});
  }

  async attachRegisteredVoucher(executionId: string, actorUserId: string, fileId: string) {
    if (!this.prisma || !this.files) throw new BadRequestException("凭证服务暂不可用，请保留文件后重试");
    const run = async (tx: Prisma.TransactionClient) => {
      await assertRegisteredPaymentActor(tx, actorUserId);
      const funding = await tx.registeredPaymentFunding.findUnique({where:{executionId}});
      const execution = funding ? await tx.paymentExecution.findUnique({where:{id:executionId}}) : null;
      if (!execution) throw new BadRequestException("未找到该笔正式资金登记，请刷新付款记录");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentExecution" WHERE "id" = ${executionId} FOR UPDATE`);
      const prior = await tx.registeredPaymentVoucher.findUnique({where:{executionId}});
      if (prior) {
        if (prior.fileId !== fileId) throw new ConflictException("原实付已补充凭证，不能覆盖已冻结证据");
        return {executionId,voucherPending:false};
      }
      const locked = await this.files!.assertFileHasNoBusinessBinding(tx,fileId,{executionId,actorUserId});
      if (locked.uploadedByUserId !== actorUserId) throw new ForbiddenException("后补凭证须由当前办理人上传");
      const file = await tx.fileObject.findUnique({where:{id:fileId}});
      if (!file || !file.contentSha256 || !/^[a-f0-9]{64}$/.test(file.contentSha256)) throw new BadRequestException("付款凭证内容校验信息不完整，请重新上传");
      await tx.registeredPaymentVoucher.create({data:{executionId,fileId,uploadedByUserId:actorUserId,contentSha256:file.contentSha256}});
      await this.audit.record(tx,{actorUserId,action:"payment.execution.voucher.attach",businessType:"payment_request",businessId:execution.paymentRequestId,metadata:{executionId,fileId,contentSha256:file.contentSha256}});
      return {executionId,voucherPending:false};
    };
    try { return await this.prisma.$transaction(run,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (["P2002","P2034"].includes(paymentPrismaErrorCode(error)??"")) {
        return this.prisma.$transaction(async tx=>{
          await assertRegisteredPaymentActor(tx,actorUserId);
          const prior=await tx.registeredPaymentVoucher.findUnique({where:{executionId}});
          if (prior?.fileId===fileId) return {executionId,voucherPending:false};
          throw new ConflictException("付款凭证记录已变化，请先查询原实付后重试");
        });
      }
      throw error;
    }
  }

  async registeredExecutionOptions(paymentId: string, actorUserId: string, includeProjectAdvance = false) {
    if (!this.prisma) throw new ConflictException("付款登记服务暂不可用");
    return this.prisma.$transaction(async tx => {
      const roles = await assertRegisteredPaymentActor(tx,actorUserId);
      const payment = await tx.paymentRequest.findUnique({where:{id:paymentId}});
      if (!payment || payment.paymentSubjectType !== "our_company" || !["approved_pending_payment","partially_paid"].includes(payment.status)) throw new ConflictException("当前申请暂不能登记实际付款，请刷新共同待办");
      if (payment.remainingWithdrawnCents != null) throw new ConflictException("原付款申请的未付金额已撤回");
      if (!(await currentRegisteredPaymentDomain(tx,payment.id)).supportedDomain) throw new ConflictException("当前付款不属于统一实付办理范围，请经原业务权限入口核验");
      if (!(await registeredPaymentInstalled(tx))) throw new ConflictException("统一实付尚未启用，请通过原付款入口办理");
      const round = await currentRegisteredPaymentApproval(tx,payment.id);
      if (!round || round.status !== "approved") throw new ConflictException("当前付款审批尚未通过，请刷新共同待办");
      const version = await tx.contractVersion.findUnique({where:{id:payment.contractVersionId}});
      const contract = await tx.contract.findUnique({where:{id:payment.contractId}});
      if (!version || !contract || version.contractId !== contract.id || contract.projectId !== payment.projectId || version.signingSubjectType !== "our_company") throw new ConflictException("付款申请的合同与冻结主体依据不完整");
      const ownershipReadsEnabled = includeProjectAdvance &&
        (await tx.$queryRaw<Array<{ usable: boolean }>>`SELECT
          coalesce(has_function_privilege(to_regprocedure('public.jg_registered_fund_source_ownership(text[])'), 'EXECUTE'), false)
          AND coalesce(has_table_privilege(to_regclass('public."RegisteredFundCompanyOwnedReceipt"'), 'SELECT'), false)
          AND coalesce(has_table_privilege(to_regclass('public."RegisteredPaymentProjectAdvance"'), 'INSERT'), false) AS usable`)[0]?.usable === true;
      const accounts = [];
      for (const account of await tx.registeredFundAccount.findMany({
        orderBy: { scopeKey: "asc" },
        select: { id: true, scopeKey: true, kind: true, companyEntityId: true }
      })) {
        const registration = await tx.fundAccountBalanceRegistration.findFirst({where:{accountId:account.id,status:"confirmed"},orderBy:{version:"desc"}});
        const company = account.companyEntityId ? await tx.companyEntity.findUnique({where:{id:account.companyEntityId}}) : null;
        let reason = registration ? null : "账户尚未登记有效核对余额";
        if (account.kind === "public_cash" && !roles.some(role => role === "finance_staff" || role === "finance_director")) {
          const custodian = await currentPublicCashCustodian(tx, account.id);
          if (custodian && custodian !== actorUserId) reason = "当前公共现金操作由具名保管人办理";
        }
        if (account.kind === "company" && !company) reason = "账户公司档案不可用，请核对原资料";
        if (company?.isActive === false) {
          if (company.id !== version.companyEntityIdSnapshot) reason = "停用公司不能新选为代付主体";
          else {
            try {
              await this.assertInactiveOriginalCompanyReference(tx,{
                status:payment.status,projectId:payment.projectId,contractProjectId:contract.projectId,contractVersionStatus:version.status,
                companyEntityVersionId:version.companyEntityVersionId,companyEntityIdSnapshot:version.companyEntityIdSnapshot,
                companyEntityNameSnapshot:version.companyEntityNameSnapshot,companyEntityCreditCodeSnapshot:version.companyEntityCreditCodeSnapshot
              });
            } catch (error) {
              if (!(error instanceof ConflictException)) throw error;
              reason = error.message;
            }
          }
        }
        let projectAdvanceSourceBatchIds: string[] | undefined;
        if (ownershipReadsEnabled && !reason && registration && company?.isActive && company.id === version.companyEntityIdSnapshot) {
          const eligible = await tx.fundAccountSourceBatch.findMany({
            where: { registrationId: registration.id, projectStatus: "pending" }, select: { id: true }
          });
          const ownership = await readRegisteredCompanyOwnedSources(tx, eligible.map(row => row.id));
          projectAdvanceSourceBatchIds = eligible.filter(row => ownership.get(row.id) === company.id).map(row => row.id);
        }
        accounts.push({scopeKey:account.scopeKey,name:account.kind === "public_cash" ? "公共现金" : company?.id === version.companyEntityIdSnapshot ? version.companyEntityNameSnapshot ?? "原付款公司" : company?.name ?? "公司资料待核对",eligible:reason === null,reason,currentRegistrationId:registration?.id ?? null,...(projectAdvanceSourceBatchIds ? { projectAdvanceSourceBatchIds } : {})});
      }
      const contractHistoryBasis = await registeredContractHistoryBasis(tx,payment.contractId);
      const originalResults = await registeredOriginalPaymentResults(tx,payment.id);
      const remainingAmountCents = (payment.approvedAmountCents??payment.requestedAmountCents)-payment.paidAmountCents;
      return {paymentId:payment.id,code:payment.code,projectId:payment.projectId,expectedPaymentUpdatedAt:payment.updatedAt.toISOString(),paidAmountCents:payment.paidAmountCents.toString(),remainingAmountCents:remainingAmountCents.toString(),canRegisterPayment:remainingAmountCents>0n,accounts,originalResults,contractHistoryBasis};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }

  async recordRegisteredExecution(paymentId: string, actorUserId: string, input: RecordRegisteredPaymentExecutionDto) {
    return this.executePayment(paymentId, actorUserId, { ...input, voucherFileId: "" }, input);
  }

  async recordExecution(paymentId: string, actorUserId: string, input: RecordPaymentExecutionDto) {
    return this.executePayment(paymentId, actorUserId, input);
  }

  private async executePayment(
    paymentId: string,
    actorUserId: string,
    input: RecordPaymentExecutionDto,
    registered?: RecordRegisteredPaymentExecutionDto
  ) {
    if (!this.prisma) {
      throw new Error("付款实付登记服务暂不可用，请稍后重试或联系管理员");
    }
    if (!registered && (!this.files || !this.projectFunding)) {
      throw new Error("付款实付登记依赖服务暂不可用，请稍后重试或联系管理员");
    }

    const amountCents = positiveMoneyCents(input.amountCents, "实付金额必须大于 0");
    const wagePayableBindings = normalizeWagePayableBindings(input.wagePayableBindings);
    const payerAttestation = normalizePayerAttestation(input.payerAttestation);
    const observationSelectionRef = input.observationSelectionRef?.trim() || null;
    if (observationSelectionRef && !payerAttestation) {
      throw new BadRequestException(
        "认领银行流水的付款执行必须提交服务端付款账户核验引用"
      );
    }
    if (observationSelectionRef && !this.sharedAllocations) {
      throw new Error("付款执行共享分配服务暂不可用，请稍后重试");
    }
    const wageBindingTotalCents = wagePayableBindings.reduce(
      (total, binding) => total + binding.amountCents,
      0n
    );
    if (wagePayableBindings.length > 0 && wageBindingTotalCents !== amountCents) {
      throw new BadRequestException("工资债权关联金额必须完整等于本次实付金额");
    }
    const idempotencyKey = input.idempotencyKey?.trim().toLowerCase();
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        idempotencyKey
      )
    ) {
      throw new BadRequestException("付款实付登记幂等键必须是 UUID");
    }
    const expectedPaymentUpdatedAt = new Date(input.expectedPaymentUpdatedAt);
    if (Number.isNaN(expectedPaymentUpdatedAt.getTime())) {
      throw new BadRequestException("预期付款申请版本格式不正确");
    }

    const voucherFileId = input.voucherFileId?.trim() ?? "";
    if (!registered && !voucherFileId) {
      throw new Error("登记实付必须上传付款凭证");
    }

    if (!input.confirmationPassword?.trim()) {
      throw new Error("登记实付需要当前登录密码确认");
    }

    let paidAt: Date;
    try { paidAt = requiredPastChinaDate(input.paidAt, "实付日期"); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "实付日期格式不正确，请核对实际日期"); }

    if (!this.auth) {
      throw new Error("登记实付确认服务暂不可用，请稍后重试或联系管理员");
    }

    const files = this.files;
    const projectFunding = this.projectFunding;
    const registeredCoordinates = { idempotencyKey, paymentId, actorUserId, amountCents, paidAt };

    try {
      const execution = await this.prisma.$transaction(async (tx) => {
        await this.lockPaymentExecutionReceipt(tx, idempotencyKey);
        const paymentExecutionClient = tx.paymentExecution as unknown as {
          findUnique(args: {
            where: { idempotencyKey: string };
          }): Promise<PaymentExecutionFactRow | null>;
          create(args: {
            data: Record<string, unknown>;
          }): Promise<PaymentExecutionFactRow>;
        };
        const existingExecution = await paymentExecutionClient.findUnique({
          where: { idempotencyKey }
        });
        if (registered) await assertRegisteredPaymentActor(tx, actorUserId);
        if (registered?.existingSource && registered.confirmedProjectAdvance) {
          throw new BadRequestException("复核原实付时不能同时确认新的项目垫资");
        }
        if (registered?.existingSource) {
          const proof = await resolveRegisteredExistingSource(tx,paymentId,registered.existingSource.type,registered.existingSource.id);
          if (proof.source.version !== registered.existingSource.expectedVersion || proof.source.fingerprint !== registered.existingSource.expectedFingerprint) throw new ConflictException("历史来源版本已变化，请重新核验原结果");
          if (!proof.samePaymentRequest) throw new ConflictException("已计历史但未建立同一申请关联，请核对原历史记录，不能重复登记付款");
          if (!("originalResultKey" in proof) || proof.originalResultKey !== idempotencyKey || proof.amountCents !== amountCents.toString() || proof.paidAt !== chinaDateOnly(paidAt) || !existingExecution || existingExecution.id !== proof.originalExecutionId || existingExecution.paymentRequestId !== paymentId) throw new ConflictException("历史实付只可使用原请求查看原结果，不能换键或变更金额日期重复登记");
          return existingExecution;
        }
        if (existingExecution && registered) {
          const receiptStatus = await this.readRegisteredPaymentReceiptStatus(tx, existingExecution, registeredCoordinates, registered);
          if (receiptStatus === "missing") throw registeredPaymentResultUnconfirmed(idempotencyKey);
          if (receiptStatus === "mismatch") {
            throw new ConflictException("原请求已绑定不同的实付登记内容，请查询原结果");
          }
          return existingExecution;
        }
        if (existingExecution) {
          await this.assertPaymentExecutionReceiptReplay(tx, existingExecution, {
            paymentId,
            actorUserId,
            idempotencyKey,
            amountCents,
            paidAt,
            voucherFileId,
            wagePayableBindings,
            payerAttestation,
            observationSelectionRef,
            bankReceiptReference: input.bankReceiptReference
          });
          return existingExecution;
        }

        if (registered) await this.auth!.confirmPassword(actorUserId, input.confirmationPassword, tx);
        else await this.auth!.confirmPassword(actorUserId, input.confirmationPassword);
        const fundingScope = await tx.paymentRequest.findFirst({
          where: {
            OR: [{ id: paymentId }, { code: paymentId }]
          },
          select: {
            id: true,
            projectId: true
          }
        });
        if (!fundingScope) {
          throw new Error("未找到付款申请，请刷新付款台账后重试");
        }
        if (!registered) await projectFunding!.lockFundingContext(tx, fundingScope.projectId);

        const payment = await this.lockPaymentRequestForUpdate(tx, paymentId);

        if (!payment) {
          throw new Error("未找到付款申请，请刷新付款台账后重试");
        }
        if (
          fundingScope.id !== payment.id ||
          fundingScope.projectId !== payment.projectId
        ) {
          throw new ConflictException("付款申请的项目资金范围已变化，请刷新后重试");
        }
        if (!registered) await this.assertCurrentProjectFinanceStaff(
          tx,
          actorUserId,
          payment.projectId
        );
        if (wagePayableBindings.length > 0) {
          throw new GoneException("付款登记已停止新增工资应付关联，可查询历史记录");
        }
        if (observationSelectionRef) {
          // Short-lived bank references remain valid only for matching historical wage receipts.
          throw new BadRequestException("只有完整关联已确认工资应付的付款执行才能认领银行流水");
        }
        if (registered && !(await currentRegisteredPaymentDomain(tx,payment.id)).supportedDomain) throw new ConflictException("当前付款不属于统一实付办理范围，请经原业务权限入口核验");
        if (
          payment.paymentSubjectType === "affiliate" ||
          payment.signingSubjectType === "affiliate"
        ) {
          throw new BadRequestException(
            "施工企业付款申请不得登记我方实际付款，请登记施工企业外部付款事实"
          );
        }
        if (
          payment.paymentSubjectType !== "our_company" ||
          payment.signingSubjectType !== "our_company"
        ) {
          throw new BadRequestException(
            "付款申请或合同版本不是我方付款主体，不能登记实际付款"
          );
        }
        const companyEntityIdSnapshot = payment.companyEntityIdSnapshot?.trim();
        const companyEntityNameSnapshot = payment.companyEntityNameSnapshot?.trim();
        const companyEntityCreditCodeSnapshot =
          payment.companyEntityCreditCodeSnapshot?.trim();
        if (
          !companyEntityIdSnapshot ||
          !companyEntityNameSnapshot ||
          !companyEntityCreditCodeSnapshot
        ) {
          throw new ConflictException(
            "付款合同缺少完整的我方付款主体快照，请先补齐合同主体后重试"
          );
        }

        if (payment.updatedAt.getTime() !== expectedPaymentUpdatedAt.getTime()) {
          throw new ConflictException("付款申请已变化，请刷新后重试");
        }

        if (payment.remainingWithdrawnCents != null) {
          throw new ConflictException("原付款申请的未付金额已撤回");
        }
        if (!["approved_pending_payment", "partially_paid"].includes(payment.status)) {
          throw new Error(this.paymentExecutionBlockedMessage(payment.status));
        }
        const textAgreementPayment = payment.contractDueBasis === PAYMENT_TEXT_AGREEMENT_BASIS;
        if ((registered || textAgreementPayment) && !(await currentRegisteredPaymentApproval(tx, payment.id))) {
          throw new ConflictException("当前付款审批尚未通过或已变化，不能沿旧申请状态登记实付，请刷新共同待办");
        }
        if (textAgreementPayment && payment.approvedAmountCents === null) {
          throw new ConflictException("付款申请缺少明确的批准金额");
        }
        const registeredHistoryRevision=registered?await lockRegisteredContractHistoryRevision(tx,payment.contractId):null;

        if (payment.sourceType === "contract_due" && !payment.settlementId) {
          await this.lockContractPaymentCapacityRows(tx, payment.contractId);
          await this.assertHistoricalTakeoverPaymentReady(tx, {
            contractId: payment.contractId,
            contractVersionId: payment.contractVersionId,
            sourceType: "contract_due",
            actorUserId,
            actionLabel: "登记实付"
          });
        } else if (payment.sourceType === "contract_advance") {
          await this.lockContractAdvancePaymentRows(tx, payment.contractId);
          await this.assertHistoricalTakeoverPaymentReady(tx, {
            contractId: payment.contractId,
            contractVersionId: payment.contractVersionId,
            sourceType: "contract_advance",
            actorUserId,
            actionLabel: "登记实付"
          });
        }

        const approvedAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
        const remainingAmountCents = approvedAmountCents - payment.paidAmountCents;
        if (amountCents > remainingAmountCents) {
          const message = `实付金额超过付款申请剩余可实付金额，当前最多可实付 ${this.formatYuan(remainingAmountCents > 0n ? remainingAmountCents : 0n)} 元`;
          if (registered) throw new BadRequestException(message);
          throw new Error(message);
        }

        if (payment.sourceType === "signed_settlement") {
          await this.assertSignedSettlementPaymentExecutionCapacity(
            tx,
            payment,
            amountCents,
            actorUserId
          );
        }

        const newPaymentPaidAmountCents = payment.paidAmountCents + amountCents;
        if (textAgreementPayment) await this.assertTextAgreementCapacity(tx, payment, newPaymentPaidAmountCents);
        const newPaymentStatus =
          newPaymentPaidAmountCents >= approvedAmountCents ? "paid" : "partially_paid";
        let settlement:
          | {
              id: string;
              contractId: string;
              contractVersionId: string;
              status: string;
              payableAmountCents: bigint;
              paidAmountCents: bigint;
            }
          | null = null;
        let newSettlementPaidAmountCents: bigint | null = null;
        let newSettlementStatus: "paid" | "partially_paid" | null = null;

        if (payment.settlementId) {
          await this.lockSettlementForPaymentExecution(tx, payment.settlementId);
          settlement = await tx.settlement.findUnique({
            where: { id: payment.settlementId }
          });

          if (!settlement) {
            throw new Error("未找到关联结算，请先核对结算归档记录");
          }
          if (!canCreatePaymentFromSettlementStatus(settlement.status as SettlementStatus)) {
            throw new Error(
              "当前结算不是已归档可付款状态，不能登记实付；请先核对结算归档或更正记录"
            );
          }
          await this.assertHistoricalTakeoverPaymentReady(tx, {
            contractId: settlement.contractId,
            contractVersionId: settlement.contractVersionId,
            sourceType: "settlement",
            actorUserId,
            actionLabel: "登记实付"
          });

          const proxyPaidCents = await this.sumProjectProxyPaymentCents(tx, settlement.id);
          const contractDueAllocatedCents =
            await this.sumContractDueAllocatedCentsForSettlement(tx, settlement.id);
          const settlementExecutionRemainingCents =
            settlement.payableAmountCents -
            settlement.paidAmountCents -
            proxyPaidCents -
            contractDueAllocatedCents;
          if (amountCents > settlementExecutionRemainingCents) {
            throw new Error(
              `实付金额超过结算剩余可付金额，当前最多可实付 ${this.formatYuan(
                settlementExecutionRemainingCents > 0n
                  ? settlementExecutionRemainingCents
                  : 0n
              )} 元`
            );
          }

          newSettlementPaidAmountCents = settlement.paidAmountCents + amountCents;
          newSettlementStatus =
            newSettlementPaidAmountCents >= settlement.payableAmountCents
              ? "paid"
              : "partially_paid";
        }

        // Keep the shared FileObject advisory lock last in the business-lock
        // order. Other payment writers lock contract/settlement rows before
        // their file-binding trigger runs, so taking the file lock earlier can
        // deadlock with those workflows.
        if (!registered) {
          const lockedVoucher = await files!.assertFileHasNoBusinessBinding(tx, voucherFileId);
          if (lockedVoucher.uploadedByUserId !== actorUserId) throw new ForbiddenException("付款凭证必须由当前登记人上传");
        }
        if (registered && payment.companyDirectoryIsActive === false) await this.assertInactiveOriginalCompanyReference(tx,payment);
        const contractHistoryConfirmation = registered ? await confirmRegisteredContractHistory(tx,payment.contractId,registered,registeredHistoryRevision!) : null;
        const registeredFunding = registered ? await prepareRegisteredFunding(tx, actorUserId, payment, registered,registeredHistoryRevision!) : null;

        // The original obligation and the actual bank holder are independent authorities.
        if (!registered && payment.companyDirectoryIsActive === false) {
          await this.assertInactiveOriginalCompanyReference(tx, payment);
        }
        const bankEvent = registered ? null : await requireContractBankEvent(tx, {projectId:payment.projectId,reference:input.bankReceiptReference,companyId:payerAttestation?(await tx.paymentExecutionPayerVerification.findUniqueOrThrow({where:{reference:payerAttestation.bankAccountReference}})).holderCompanyEntityId:companyEntityIdSnapshot!,amountCents,occurredAt:paidAt,direction:"outflow"});
        if (!registered && payment.companyDirectoryIsActive === false && !payerAttestation) {
          if (!bankEvent?.payerVerificationId) {
            throw new ConflictException("停用公司原单缺少可核实的当前银行账户依据");
          }
          const authority = await tx.paymentExecutionPayerVerification.findUnique({ where: { id: bankEvent.payerVerificationId } });
          if (!authority || authority.status !== "verified" || authority.sourceType !== "bank_account_legal_holder" || !authority.sourceRecordId?.trim() || authority.verifiedAt.getTime() > Date.now()) {
            throw new ConflictException("原单银行账户核验已失效或来源不明确");
          }
          if (authority.verifiedByUserId === actorUserId) throw new ConflictException("银行账户核验人与付款执行登记人必须职责分离");
          await this.assertInactiveDirectoryContinuation(tx, payment, authority);
          await this.assertGlobalFinanceDirectorUser(tx, authority.verifiedByUserId, "银行账户核验人必须是有效的全系统财务负责人");
          const evidence = await tx.fileObject.findUnique({ where: { id: authority.verificationEvidenceFileId } });
          if (!evidence || evidence.storageStatus !== "active" || evidence.uploadedByUserId !== authority.verifiedByUserId || evidence.contentSha256 !== authority.verificationEvidenceContentSha256) {
            throw new ConflictException("原单银行账户核验证据已失效或身份不一致");
          }
        }
        const executionId = randomUUID();
        const execution = await paymentExecutionClient.create({
          data: {
            ...(payerAttestation ? { id: executionId } : {}),
            idempotencyKey,
            paymentRequestId: payment.id,
            settlementId: payment.settlementId,
            paymentSubjectType: "our_company",
            companyEntityIdSnapshot,
            companyEntityNameSnapshot,
            companyEntityCreditCodeSnapshot,
            amountCents,
            paidAt,
            executedByUserId: actorUserId,
            voucherFileId: registered ? null : voucherFileId,
            ...(payerAttestation
              ? { payerAttestationFingerprint: payerAttestation.fingerprint }
              : {})
          }
        });
        if (registered && registeredFunding) {
          await appendRegisteredFunding(tx,execution.id,registeredFunding,registered,actorUserId,contractHistoryConfirmation);
          await appendRegisteredIntercompany(tx,execution.id,actorUserId,payment,registeredFunding,amountCents);
        }
        if (payerAttestation) {
          await this.persistPayerAttestation(
            tx,
            execution.id ?? executionId,
            payment.id,
            payment.contractVersionId,
            actorUserId,
            payerAttestation,
            payment
          );
        }
        if(bankEvent)await claimContractBankEvent(tx,bankEvent.id,"payment_execution",execution.id,actorUserId);
        const fundingAllocation = registered
          ? null
          : await projectFunding!.allocateExecution(tx, {
              projectId: payment.projectId,
              executionType: "payment_execution",
              executionId: execution.id,
              businessType: "payment_request",
              businessId: payment.id,
              amountCents,
              occurredAt: paidAt,
              actorUserId
            });

        if (payment.sourceType === "contract_due" && !payment.settlementId) {
          try {
            await this.createContractDuePaymentExecutionAllocations(
              tx,
              payment,
              execution.id,
              amountCents,
              paidAt,
              actorUserId
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (
              message === "未找到可分摊的有效结算来源，请先核对合同结算和历史期初结算" ||
              message.startsWith("登记实付金额超过当前可分摊的到期应付款")
            ) {
              throw new BadRequestException(message);
            }
            throw error;
          }
        }

        await tx.paymentRequest.update({
          where: { id: payment.id },
          data: {
            paidAmountCents: newPaymentPaidAmountCents,
            status: newPaymentStatus
          }
        });

        if (settlement && newSettlementPaidAmountCents !== null && newSettlementStatus) {
          await tx.settlement.update({
            where: { id: settlement.id },
            data: {
              paidAmountCents: newSettlementPaidAmountCents,
              status: newSettlementStatus
            }
          });
        }

        await this.appendOperatingPaymentExecution(
          tx,
          payment.projectId,
          execution.id,
          actorUserId
        );

        await this.audit.record(tx, {
          actorUserId,
          action: "payment.execution.record",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            projectId: payment.projectId,
            executionId: execution.id,
            amountCents: moneyCentsToApi(amountCents),
            paidAt: paidAt.toISOString(),
            voucherFileId: registered ? null : voucherFileId,
            ...(registeredFunding ? { voucherPending: true, actualPayer: registeredFunding.actualPayer } : {}),
            ...(registeredFunding?.projectAdvance ? { projectAdvanceAmountCents: registeredFunding.projectAdvance.amount.toString() } : {}),
            idempotencyKey,
            payer: {
              paymentSubjectType: "our_company",
              companyEntityIdSnapshot,
              companyEntityNameSnapshot,
              companyEntityCreditCodeSnapshot
            },
            funding: fundingAllocation
              ? {
                  kind: fundingAllocation.kind,
                  projectCashAmountCents: moneyCentsToApi(
                    fundingAllocation.projectCashAmountCents
                  ),
                  financingQuotaAmountCents: moneyCentsToApi(
                    fundingAllocation.financingQuotaAmountCents
                  ),
                  allocations: fundingAllocation.allocations.map(
                    (allocation) => ({
                      sourceType: allocation.sourceType,
                      sourceId: allocation.sourceId,
                      amountCents: moneyCentsToApi(allocation.amountCents)
                    })
                  )
                }
              : { kind: "registered_fund_account", accountId: registeredFunding!.account.id, balanceRegistrationId: registeredFunding!.current.id, openingTreatment: registered!.openingTreatment },
            fromStatus: payment.status,
            toStatus: newPaymentStatus
          }
        });

        if (registeredFunding) await enforceRegisteredPaymentAdvanceConstraints(tx, registeredFunding);
        return execution;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });

      const confirmedExecution = registered && !registered.existingSource
        ? await this.readCommittedRegisteredPayment({
            executionId: execution.id, ...registeredCoordinates, input: registered
          })
        : execution;
      return wagePayableBindings.length > 0
        ? wagePaymentExecutionResponseToApi(confirmedExecution)
        : paymentPostResponseToApi(confirmedExecution);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = paymentPrismaErrorCode(error);
      const serializationConflict =
        code === "P2034" || isPostgresSerializationFailure(error);
      if (code === "P2002" || serializationConflict) {
        if (registered) {
          const prior = await this.prisma.$transaction(async tx => {
            await assertRegisteredPaymentActor(tx, actorUserId);
            const fact = await tx.paymentExecution.findUnique({ where: { idempotencyKey } });
            if (!fact) return null;
            if (registered.existingSource) {
              const source = registered.existingSource;
              const proof = await resolveRegisteredExistingSource(tx,paymentId,source.type,source.id);
              if (proof.source.version !== source.expectedVersion || proof.source.fingerprint !== source.expectedFingerprint || !proof.samePaymentRequest || !("originalResultKey" in proof) || proof.originalResultKey !== idempotencyKey || proof.originalExecutionId !== fact.id || fact.paymentRequestId !== paymentId || proof.amountCents !== amountCents.toString() || proof.paidAt !== chinaDateOnly(paidAt)) throw new ConflictException("历史来源或原实付身份已变化，请先查询原结果并重新核验");
              return fact;
            }
            const receiptStatus = await this.readRegisteredPaymentReceiptStatus(tx, fact, registeredCoordinates, registered);
            if (receiptStatus === "missing") throw registeredPaymentResultUnconfirmed(idempotencyKey);
            if (receiptStatus === "mismatch") {
              throw new ConflictException("原请求已绑定不同实付内容，请查询原结果");
            }
            return this.matchesRegisteredPaymentExecution(fact, registeredCoordinates) ? fact : null;
          },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}).catch(recoveryError => {
            if (recoveryError instanceof HttpException) throw recoveryError;
            throw registeredPaymentResultUnconfirmed(idempotencyKey);
          });
          if (prior) return paymentPostResponseToApi(prior);
          throw registeredPaymentResultUnconfirmed(idempotencyKey);
        }
        const concurrentExecution = await this.resolveConcurrentPaymentExecution({
          paymentId,
          actorUserId,
          idempotencyKey,
          amountCents,
          paidAt,
          voucherFileId,
          wagePayableBindings,
          payerAttestation,
          observationSelectionRef,
          bankReceiptReference: input.bankReceiptReference
        });
        if (concurrentExecution) {
          return wagePayableBindings.length > 0
            ? wagePaymentExecutionResponseToApi(concurrentExecution)
            : paymentPostResponseToApi(concurrentExecution);
        }
        throw new ConflictException(
          serializationConflict
            ? "实际付款并发冲突，请刷新后重试"
            : "实际付款唯一事实已变化，请刷新后重试"
        );
      }
      throw error;
    }
  }

  private async readRegisteredPaymentReceiptStatus(
    tx: Prisma.TransactionClient,
    execution: PaymentExecutionFactRow,
    coordinates: RegisteredPaymentCoordinates,
    input: RecordRegisteredPaymentExecutionDto
  ): Promise<"matched" | "mismatch" | "missing"> {
    const { paymentId, actorUserId } = coordinates;
    const request = await tx.paymentRequest.findFirst({
      where: { OR: [{ id: paymentId }, { code: paymentId }] },
      select: { id: true, projectId: true }
    });
    if (!request || execution.paymentRequestId !== request.id) return "mismatch";
    const receipt = await tx.registeredPaymentFunding.findUnique({ where: { executionId: execution.id } });
    if (!receipt) return execution.voucherFileId === null && this.matchesRegisteredPaymentExecution(execution, coordinates) ? "missing" : "mismatch";
    if (receipt.payloadFingerprint !== registeredPaymentFingerprint(request.id, actorUserId, input)) return "mismatch";
    if (!input.confirmedProjectAdvance) return "matched";
    return readRegisteredProjectAdvanceStatus(tx, execution.id, {
      actorUserId, projectId: request.projectId, accountId: receipt.accountId, companyId: receipt.actualPayerId,
      input: input.confirmedProjectAdvance
    });
  }

  private matchesRegisteredPaymentExecution(
    execution: PaymentExecutionFactRow,
    { idempotencyKey, actorUserId, amountCents, paidAt }: RegisteredPaymentCoordinates
  ) {
    return execution.idempotencyKey === idempotencyKey &&
      execution.executedByUserId === actorUserId &&
      execution.amountCents === amountCents &&
      execution.paidAt.getTime() === paidAt.getTime();
  }

  private async readCommittedRegisteredPayment(expected: RegisteredPaymentCoordinates & {
    executionId: string;
    input: RecordRegisteredPaymentExecutionDto;
  }) {
    const { executionId, idempotencyKey, input } = expected;
    let committed: PaymentExecutionFactRow | null;
    try {
      // A fulfilled interactive callback is insufficient evidence for the HTTP receipt.
      committed = await this.prisma!.$transaction(async tx => {
        const current = await tx.paymentExecution.findUnique({ where: { idempotencyKey } });
        if (!current || current.id !== executionId || !this.matchesRegisteredPaymentExecution(current, expected)) return null;
        const receiptStatus = await this.readRegisteredPaymentReceiptStatus(tx, current, expected, input);
        return receiptStatus === "matched" ? current : null;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch {
      throw registeredPaymentResultUnconfirmed(idempotencyKey);
    }
    if (!committed) throw registeredPaymentResultUnconfirmed(idempotencyKey);
    return committed;
  }

  private async appendOperatingPaymentExecution(
    tx: Prisma.TransactionClient,
    projectId: string,
    paymentExecutionId: string,
    actorUserId: string
  ): Promise<void> {
    await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
      tx,
      {
        projectId,
        sourceType: PAYMENT_EXECUTION_SOURCE_TYPE,
        sourceBusinessId: paymentExecutionId
      },
      actorUserId
    );
  }

  private async assertGlobalFinanceDirectorUser(
    tx: Prisma.TransactionClient,
    userId: string,
    message: string
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { isActive: true }
    });
    if (!user?.isActive) throw new ConflictException(message);
    const assignments = await tx.userPosition.findMany({
      where: { userId, projectId: null },
      select: { positionId: true }
    });
    const positionIds = [...new Set(assignments.map(({ positionId }) => positionId))];
    if (!positionIds.length) throw new ConflictException(message);
    const positions = await tx.position.findMany({
      where: { id: { in: positionIds } },
      select: { key: true }
    });
    if (!positions.some(({ key }) => key === "finance_director")) {
      throw new ConflictException(message);
    }
  }

  private async assertInactiveOriginalCompanyReference(tx: Prisma.TransactionClient, payment: Pick<PaymentExecutionLockRow, "status" | "projectId" | "contractProjectId" | "contractVersionStatus" | "companyEntityVersionId" | "companyEntityIdSnapshot" | "companyEntityNameSnapshot" | "companyEntityCreditCodeSnapshot">) {
    if (!["effective", "superseded"].includes(payment.contractVersionStatus) || payment.contractProjectId !== payment.projectId ||
        !["approved_pending_payment", "partially_paid"].includes(payment.status)) {
      throw new ConflictException("原单尚未批准、合同未生效或项目来源不一致，不能沿停用主体继续付款");
    }
    if (!payment.companyEntityVersionId) {
      throw new ConflictException("原单缺少可核实的冻结主体版本");
    }
    const frozen = await tx.companyEntityVersion.findUnique({ where: { id: payment.companyEntityVersionId } });
    assertFrozenCompanyIdentity({ companyEntityId: payment.companyEntityIdSnapshot,
      nameSnapshot: payment.companyEntityNameSnapshot, creditCodeSnapshot: payment.companyEntityCreditCodeSnapshot }, frozen);
    return frozen!;
  }

  private async assertInactiveDirectoryContinuation(
    tx: Prisma.TransactionClient,
    payment: PaymentExecutionLockRow,
    authority: { holderCompanyEntityId: string; holderNameSnapshot: string; holderCreditCodeSnapshot: string }
  ) {
    const frozen = await this.assertInactiveOriginalCompanyReference(tx, payment);
    if (authority.holderCompanyEntityId !== payment.companyEntityIdSnapshot) {
      throw new ConflictException("停用公司只能沿原单冻结主体继续办理，不能新选为付款主体");
    }
    if (authority.holderNameSnapshot !== frozen.name || authority.holderCreditCodeSnapshot !== frozen.unifiedSocialCreditCode) {
      throw new ConflictException("银行账户持有人与原单冻结公司身份不一致");
    }
  }

  private async persistPayerAttestation(
    tx: Prisma.TransactionClient,
    paymentExecutionId: string,
    paymentRequestId: string,
    contractVersionId: string,
    actorUserId: string,
    attestation: NormalizedPayerAttestation,
    payment: PaymentExecutionLockRow
  ): Promise<void> {
    const now = new Date();
    const authorityClient = (tx as unknown as {
      paymentExecutionPayerVerification?: {
        findUnique(args: { where: { reference: string } }): Promise<{
          id: string;
          reference: string;
          holderCompanyEntityId: string;
          holderNameSnapshot: string;
          holderCreditCodeSnapshot: string;
          verificationReference: string;
          verifiedByUserId: string;
          verifiedAt: Date;
          verificationEvidenceFileId: string;
          verificationEvidenceContentSha256: string;
          status: string;
          sourceType: string;
          sourceRecordId: string;
        } | null>;
      };
    }).paymentExecutionPayerVerification;
    if (!authorityClient) {
      throw new ConflictException("银行账户核验权威服务暂不可用，请稍后重试");
    }
    const authority = await authorityClient.findUnique({
      where: { reference: attestation.bankAccountReference }
    });
    if (
      !authority ||
      authority.status !== "verified" ||
      authority.sourceType !== "bank_account_legal_holder" ||
      !authority.sourceRecordId.trim() ||
      authority.reference !== attestation.bankAccountReference ||
      authority.verifiedAt.getTime() > now.getTime()
    ) {
      throw new ConflictException("服务端银行账户核验引用不存在、已失效或来源不明确");
    }
    if (authority.verifiedByUserId === actorUserId) {
      throw new ConflictException("银行账户核验人与付款执行登记人必须职责分离");
    }
    await this.assertGlobalFinanceDirectorUser(
      tx,
      authority.verifiedByUserId,
      "银行账户核验人必须是有效的全系统财务负责人"
    );
    const holder = await tx.companyEntity.findUnique({
      where: { id: authority.holderCompanyEntityId },
      select: { id: true, isActive: true }
    });
    if (!holder) throw new ConflictException("银行账户法定持有人主体不存在");
    if (!holder.isActive) await this.assertInactiveDirectoryContinuation(tx, payment, authority);

    const verificationEvidence = await tx.fileObject.findUnique({
      where: { id: authority.verificationEvidenceFileId },
      select: { id: true, uploadedByUserId: true, storageStatus: true, contentSha256: true }
    });
    if (
      !verificationEvidence ||
      verificationEvidence.storageStatus !== "active" ||
      verificationEvidence.uploadedByUserId !== authority.verifiedByUserId ||
      verificationEvidence.contentSha256 !== authority.verificationEvidenceContentSha256 ||
      !/^[0-9a-f]{64}$/u.test(authority.verificationEvidenceContentSha256)
    ) {
      throw new ConflictException("银行账户核验证据不存在、已失效或内容已变化");
    }
    let approvalInstanceId: string | null = null;
    let approvalActionLogId: string | null = null;
    let authorizationEvidence: {
      id: string;
      uploadedByUserId: string;
      storageStatus: string;
      contentSha256: string | null;
    } | null = null;
    if (attestation.authorization) {
      const authorization = attestation.authorization;
      if (authorization.reauthorizedByUserId === actorUserId) {
        throw new ConflictException("重新授权人与付款执行登记人必须职责分离");
      }
      await this.assertGlobalFinanceDirectorUser(
        tx,
        authorization.reauthorizedByUserId,
        "重新授权人必须是有效的全系统财务负责人"
      );
      if (authorization.reauthorizedAt.getTime() > now.getTime()) {
        throw new ConflictException("重新授权时间不能晚于当前时间");
      }
      const actionLogClient = (tx as unknown as {
        approvalActionLog?: {
          findUnique(args: { where: { id: string } }): Promise<{
            id: string;
            approvalInstanceId: string;
            action: string;
            actorUserId: string;
            approvedRoleKey: string | null;
            createdAt: Date;
            metadata: unknown;
          } | null>;
        };
      }).approvalActionLog;
      const instanceClient = (tx as unknown as {
        approvalInstance?: {
          findUnique(args: { where: { id: string } }): Promise<{
            id: string;
            businessType: string;
            businessId: string;
            status: string;
          } | null>;
        };
      }).approvalInstance;
      if (!actionLogClient || !instanceClient) {
        throw new ConflictException("重新授权审批记录服务暂不可用，请稍后重试");
      }
      const actionLog = await actionLogClient.findUnique({
        where: { id: authorization.reauthorizationReference }
      });
      if (!actionLog) throw new ConflictException("重新授权审批记录不存在或已失效");
      const approvalInstance = await instanceClient.findUnique({
        where: { id: actionLog.approvalInstanceId }
      });
      const metadata = actionLog.metadata && typeof actionLog.metadata === "object"
        ? actionLog.metadata as Record<string, unknown>
        : {};
      if (
        !approvalInstance ||
        approvalInstance.status !== "approved" ||
        approvalInstance.businessType !== "payment_request" ||
        approvalInstance.businessId !== paymentRequestId ||
        actionLog.action !== "approve" ||
        actionLog.actorUserId !== authorization.reauthorizedByUserId ||
        actionLog.approvedRoleKey !== "finance_director" ||
        actionLog.createdAt.getTime() > now.getTime() ||
        metadata.paymentRequestId !== paymentRequestId ||
        metadata.contractVersionId !== contractVersionId
      ) {
        throw new ConflictException("重新授权审批记录未绑定当前付款申请和合同版本");
      }
      approvalInstanceId = approvalInstance.id;
      approvalActionLogId = actionLog.id;
      authorizationEvidence = await tx.fileObject.findUnique({
        where: { id: authorization.evidenceFileId },
        select: { id: true, uploadedByUserId: true, storageStatus: true, contentSha256: true }
      });
      if (
        !authorizationEvidence ||
        authorizationEvidence.storageStatus !== "active" ||
        authorizationEvidence.uploadedByUserId !== authorization.reauthorizedByUserId ||
        !authorizationEvidence.contentSha256 ||
        !/^[0-9a-f]{64}$/u.test(authorizationEvidence.contentSha256)
      ) {
        throw new ConflictException("跨主体付款授权证据不存在、已失效或内容不完整");
      }
    }
    const attestationClient = (tx as unknown as {
      paymentExecutionPayerAttestation?: {
        create(args: { data: Record<string, unknown> }): Promise<unknown>;
      };
    }).paymentExecutionPayerAttestation;
    if (!attestationClient) {
      throw new ConflictException("付款主体核验服务暂不可用，请稍后重试");
    }
    await attestationClient.create({
      data: {
        id: randomUUID(),
        paymentExecutionId,
        payerVerificationId: authority.id,
        bankAccountReference: authority.reference,
        holderCompanyEntityId: authority.holderCompanyEntityId,
        holderNameSnapshot: authority.holderNameSnapshot,
        holderCreditCodeSnapshot: authority.holderCreditCodeSnapshot,
        verificationReference: authority.verificationReference,
        verifiedByUserId: authority.verifiedByUserId,
        verifiedAt: authority.verifiedAt,
        verificationEvidenceFileId: authority.verificationEvidenceFileId,
        verificationEvidenceContentSha256: authority.verificationEvidenceContentSha256,
        ...(attestation.authorization
          ? {
              proxyAuthorizationReason: attestation.authorization.reason,
              proxyAuthorizationEvidenceFileId: attestation.authorization.evidenceFileId,
              proxyAuthorizationEvidenceSha256: authorizationEvidence?.contentSha256,
              reauthorizationReference: attestation.authorization.reauthorizationReference,
              reauthorizationApprovalInstanceId: approvalInstanceId,
              reauthorizationApprovalActionLogId: approvalActionLogId,
              reauthorizationPaymentRequestId: paymentRequestId,
              reauthorizationContractVersionId: contractVersionId,
              reauthorizedByUserId: attestation.authorization.reauthorizedByUserId,
              reauthorizedAt: attestation.authorization.reauthorizedAt
            }
          : {})
      }
    });
  }

  private async lockPaymentExecutionReceipt(
    tx: Prisma.TransactionClient,
    idempotencyKey: string
  ) {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`payment_execution:${idempotencyKey}`}, 0)
      )
    `);
  }

  private async assertPaymentExecutionReceiptReplay(
    tx: Prisma.TransactionClient,
    existing: PaymentExecutionFactRow,
    input: {
      paymentId: string;
      actorUserId: string;
      idempotencyKey: string;
      amountCents: bigint;
      paidAt: Date;
      voucherFileId: string;
      wagePayableBindings: readonly NormalizedWagePayableBinding[];
      payerAttestation: NormalizedPayerAttestation | null;
      observationSelectionRef: string | null;
      bankReceiptReference?: string;
    }
  ) {
    const payment = await tx.paymentRequest.findFirst({
      where: {
        OR: [{ id: input.paymentId }, { code: input.paymentId }]
      },
      select: {
        id: true,
        projectId: true,
        settlementId: true,
        contractVersionId: true,
        paymentSubjectType: true
      }
    });
    if (!payment || payment.paymentSubjectType !== "our_company") {
      throw new ConflictException("该付款实付登记幂等键已绑定不同的付款申请");
    }
    const version = await tx.contractVersion.findUnique({
      where: { id: payment.contractVersionId },
      select: {
        signingSubjectType: true,
        companyEntityIdSnapshot: true,
        companyEntityNameSnapshot: true,
        companyEntityCreditCodeSnapshot: true
      }
    });
    const companyEntityIdSnapshot = version?.companyEntityIdSnapshot?.trim();
    const companyEntityNameSnapshot = version?.companyEntityNameSnapshot?.trim();
    const companyEntityCreditCodeSnapshot =
      version?.companyEntityCreditCodeSnapshot?.trim();
    if (
      version?.signingSubjectType !== "our_company" ||
      !companyEntityIdSnapshot ||
      !companyEntityNameSnapshot ||
      !companyEntityCreditCodeSnapshot
    ) {
      throw new ConflictException("该付款实付登记幂等键的付款主体证据不完整");
    }
    this.assertSamePaymentExecutionFacts(existing, {
      idempotencyKey: input.idempotencyKey,
      paymentRequestId: payment.id,
      settlementId: payment.settlementId,
      amountCents: input.amountCents,
      paidAt: input.paidAt,
      actorUserId: input.actorUserId,
      voucherFileId: input.voucherFileId,
      companyEntityIdSnapshot,
      companyEntityNameSnapshot,
      companyEntityCreditCodeSnapshot,
      payerAttestationFingerprint: input.payerAttestation?.fingerprint ?? null
    });

    const bindingClient = (tx as unknown as {
      paymentExecutionWagePayableBinding?: {
        findMany(args: {
          where: { paymentExecutionId: string };
          select: { wagePayableRefId: true; amountCents: true };
        }): Promise<Array<{ wagePayableRefId: string; amountCents: bigint }>>;
      };
    }).paymentExecutionWagePayableBinding;
    if (!bindingClient && input.wagePayableBindings.length > 0) {
      throw new ConflictException("工资债权关联服务暂不可用，请稍后重试");
    }
    const persistedBindings = bindingClient
      ? await bindingClient.findMany({
          where: { paymentExecutionId: existing.id },
          select: { wagePayableRefId: true, amountCents: true }
        })
      : [];
    if (persistedBindings.length > 0 || input.wagePayableBindings.length > 0) {
      await this.assertCurrentProjectFinanceStaff(tx, input.actorUserId, payment.projectId);
    }
    if (
      persistedBindings.length !== input.wagePayableBindings.length ||
      persistedBindings.some((persisted) => {
        const requested = input.wagePayableBindings.find(
          (binding) => binding.payableRef === persisted.wagePayableRefId
        );
        return !requested || requested.amountCents !== persisted.amountCents;
      })
    ) {
      throw new ConflictException("幂等键已用于不同工资债权关联载荷");
    }

    if (input.bankReceiptReference || (persistedBindings.length > 0 && !input.observationSelectionRef)) {
      const bankReceiptReference = input.bankReceiptReference || null;
      const contractClaim = await tx.contractBankEventClaim.findUnique({
        where: { sourceType_sourceId: { sourceType: "payment_execution", sourceId: existing.id } }
      });
      const bank = contractClaim
        ? await tx.verifiedBankTransactionObservation.findUnique({ where: { id: contractClaim.observationId } })
        : null;
      if ((contractClaim && !bank) || (bank?.reference ?? null) !== bankReceiptReference) {
        throw new ConflictException("原实付银行流水引用已变化，不能复用提交凭据");
      }
    }

    const claimClient = (tx as unknown as {
      bankTransactionClaim?: {
        findUnique(args: {
          where: { paymentExecutionId: string };
        }): Promise<{ selectionRefFingerprint: string } | null>;
      };
    }).bankTransactionClaim;
    if (!claimClient) {
      if (input.observationSelectionRef) {
        throw new ConflictException("共享银行认领服务暂不可用，请刷新后重试");
      }
      return;
    }
    const claim = await claimClient.findUnique({
      where: { paymentExecutionId: existing.id }
    });
    if (!claim) {
      if (input.observationSelectionRef) {
        throw new ConflictException("该付款实付登记尚未建立共享银行认领");
      }
      return;
    }
    if (!input.observationSelectionRef || !this.sharedAllocations) {
      throw new ConflictException(
        "该付款执行已认领银行流水，重放必须携带原短效选择引用"
      );
    }
    if (
      claim.selectionRefFingerprint !==
      fundExecutionSelectionRefFingerprint(input.observationSelectionRef)
    ) {
      throw new ConflictException("该付款实付登记已绑定不同的银行流水候选");
    }
    await this.sharedAllocations.assertReplayInTransaction(tx, {
      actorUserId: input.actorUserId,
      auditRequestId: input.idempotencyKey,
      observationSelectionRef: input.observationSelectionRef,
      paymentExecutionId: existing.id,
      paymentRequestId: payment.id,
      projectId: payment.projectId,
      amountCents: input.amountCents,
      occurredAt: input.paidAt,
      wagePayableBindings: input.wagePayableBindings
    });
  }

  private assertSamePaymentExecutionFacts(
    existing: PaymentExecutionFactRow,
    expected: {
      idempotencyKey: string;
      paymentRequestId: string;
      settlementId: string | null;
      amountCents: bigint;
      paidAt: Date;
      actorUserId: string;
      voucherFileId: string;
      companyEntityIdSnapshot: string;
      companyEntityNameSnapshot: string;
      companyEntityCreditCodeSnapshot: string;
      payerAttestationFingerprint: string | null;
    }
  ): void {
    if (
      existing.idempotencyKey !== expected.idempotencyKey ||
      existing.paymentRequestId !== expected.paymentRequestId ||
      existing.settlementId !== expected.settlementId ||
      existing.paymentSubjectType !== "our_company" ||
      existing.companyEntityIdSnapshot !== expected.companyEntityIdSnapshot ||
      existing.companyEntityNameSnapshot !== expected.companyEntityNameSnapshot ||
      existing.companyEntityCreditCodeSnapshot !==
        expected.companyEntityCreditCodeSnapshot ||
      existing.amountCents !== expected.amountCents ||
      existing.paidAt.getTime() !== expected.paidAt.getTime() ||
      existing.executedByUserId !== expected.actorUserId ||
      existing.voucherFileId !== expected.voucherFileId ||
      (existing.payerAttestationFingerprint ?? null) !== expected.payerAttestationFingerprint
    ) {
      throw new ConflictException("该付款实付登记幂等键已绑定不同的持久事实");
    }
  }

  private async resolveConcurrentPaymentExecution(input: {
    paymentId: string;
    actorUserId: string;
    idempotencyKey: string;
    amountCents: bigint;
    paidAt: Date;
    voucherFileId: string;
    wagePayableBindings: readonly NormalizedWagePayableBinding[];
    payerAttestation: NormalizedPayerAttestation | null;
    observationSelectionRef: string | null;
    bankReceiptReference?: string;
  }): Promise<PaymentExecutionFactRow | null> {
    if (!this.prisma) return null;
    return this.prisma.$transaction(async (tx) => {
      await this.lockPaymentExecutionReceipt(tx, input.idempotencyKey);
      const existing = await tx.paymentExecution.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
      if (!existing) return null;
      await this.assertPaymentExecutionReceiptReplay(tx, existing, input);
      return existing;
    });
  }

  private paymentExecutionBlockedMessage(status: string) {
    if (status === "approval_pending") {
      return "当前付款申请还未批准，不能登记实付；请先完成付款审批";
    }
    if (status === "paid") {
      return "当前付款申请已全部实付，不能重复登记实付";
    }
    return "当前付款申请不能登记实付，请刷新付款台账后重试";
  }

  async recordFinance(paymentId: string, actorUserId: string, input: RecordFinanceRecordDto) {
    if (!this.prisma) {
      throw new Error("财务入账记录服务暂不可用，请稍后重试或联系管理员");
    }

    const amountCents = positiveMoneyCents(input.amountCents, "财务入账金额必须大于 0");

    if (!input.confirmationPassword?.trim()) {
      throw new Error("财务入账需要当前登录密码确认");
    }

    if (!this.auth) {
      throw new Error("财务入账确认服务暂不可用，请稍后重试或联系管理员");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    const financeRecord = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentRequestForUpdate(tx, paymentId);

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      if (payment.paidAmountCents <= 0n) {
        throw new Error("付款尚未登记实付，不能做财务入账");
      }

      const existingRecords = await tx.financeRecord.findMany({
        where: { paymentRequestId: payment.id }
      });
      const recordedAmountCents = sumDbMoneyToBigInt(
        existingRecords.map((record) => record.amountCents),
        "财务入账金额"
      );
      const unrecordedPaidAmountCents = payment.paidAmountCents - recordedAmountCents;
      if (amountCents > unrecordedPaidAmountCents) {
        throw new Error(
          `财务入账金额超过未入账实付金额，当前最多可入账 ${this.formatYuan(unrecordedPaidAmountCents)} 元`
        );
      }

      const financeRecord = await tx.financeRecord.create({
        data: {
          projectId: payment.projectId,
          paymentRequestId: payment.id,
          settlementId: payment.settlementId,
          direction: "outflow",
          amountCents,
          occurredAt: new Date(input.occurredAt),
          createdByUserId: actorUserId
        }
      });
      const businessEntrySnapshot = await this.businessEntry.freezeSubmissionSnapshotInTransaction(tx, actorUserId, {
        sceneKey: PAYMENT_FINANCE_ENTRY_DEFINITION.key,
        definitionVersion: PAYMENT_FINANCE_ENTRY_DEFINITION.version,
        target: { projectId: payment.projectId, entityType: "finance_record", entityId: financeRecord.id },
        expectedRevision: 0,
        values: {
          amountYuan: `${amountCents / 100n}.${(amountCents % 100n).toString().padStart(2, "0")}`,
          occurredAt: financeRecord.occurredAt.toISOString()
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.finance.record",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          financeRecordId: financeRecord.id,
          amountCents: moneyCentsToApi(amountCents),
          direction: "outflow"
        }
      });
      return { ...financeRecord, businessEntrySnapshot };
    });

    return paymentPostResponseToApi(financeRecord);
  }

  async recordPdfArchive(
    paymentId: string,
    actorUserId: string,
    input: RecordPaymentPdfArchiveDto
  ) {
    if (!this.prisma) {
      throw new Error("付款 PDF 归档服务暂不可用，请稍后重试或联系管理员");
    }

    const templateKey = input.templateKey ?? "payment_finance_archive";
    const departmentScope = input.departmentScope ?? "finance";

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      const financeRecords = await tx.financeRecord.findMany({
        where: { paymentRequestId: payment.id }
      });
      const financeRecordedAmountCents = sumDbMoneyToBigInt(
        financeRecords.map((record) => record.amountCents),
        "财务入账金额"
      );

      if (payment.paidAmountCents <= 0n || financeRecordedAmountCents < payment.paidAmountCents) {
        throw new Error("财务入账尚未覆盖全部实付金额，不能归档付款 PDF");
      }

      const file = await tx.fileObject.findUnique({
        where: { id: input.fileId }
      });

      if (!file) {
        throw new Error("未找到付款归档文件，请重新上传后再归档");
      }

      const existingPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          templateKey
        }
      });

      if (existingPdf) {
        throw new Error("付款 PDF 已归档，不能重复归档");
      }

      const pdfDocument = await tx.pdfDocument.create({
        data: {
          businessType: "payment_request",
          businessId: payment.id,
          fileId: input.fileId,
          templateKey
        }
      });
      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "payment_request",
          businessId: payment.id,
          fileId: input.fileId,
          departmentScope
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.pdf_archive.record",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code,
          pdfDocumentId: pdfDocument.id,
          archiveRecordId: archiveRecord.id,
          fileId: input.fileId,
          templateKey,
          departmentScope
        }
      });

      return { pdfDocument, archiveRecord };
    });
  }

  async generatePdfArchive(
    paymentId: string,
    actorUserId: string,
    input: GeneratePaymentPdfArchiveDto = {}
  ) {
    if (!this.prisma) {
      throw new Error("付款 PDF 生成服务暂不可用，请稍后重试或联系管理员");
    }

    if (!this.files) {
      throw new Error("付款 PDF 归档文件服务暂不可用，请稍后重试或联系管理员");
    }

    const templateKey = input.templateKey ?? "payment_finance_archive";
    const departmentScope = input.departmentScope ?? "finance";
    const source = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      const financeRecords = await tx.financeRecord.findMany({
        where: { paymentRequestId: payment.id }
      });
      const financeRecordedAmountCents = sumDbMoneyToBigInt(
        financeRecords.map((record) => record.amountCents),
        "财务入账金额"
      );

      if (payment.paidAmountCents <= 0n || financeRecordedAmountCents < payment.paidAmountCents) {
        throw new Error("财务入账尚未覆盖全部实付金额，不能生成付款 PDF");
      }

      const existingPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          templateKey
        }
      });

      if (existingPdf) {
        throw new Error("付款 PDF 已归档，不能重复归档");
      }

      return { payment, financeRecordedAmountCents };
    });
    const buffer = renderSimplePdf([
      "付款财务归档单",
      `付款编号：${source.payment.code}`,
      `归档模板：${templateKey}`,
      `申请金额：${this.formatYuan(source.payment.requestedAmountCents)} 元`,
      `批准金额：${this.formatYuan(source.payment.approvedAmountCents ?? source.payment.requestedAmountCents)} 元`,
      `已实付金额：${this.formatYuan(source.payment.paidAmountCents)} 元`,
      `财务入账金额：${this.formatYuan(source.financeRecordedAmountCents)} 元`,
      `生成时间：${new Date().toISOString()}`
    ]);
    const file = await this.files.uploadPrivateFile({
      originalName: `${source.payment.code}-${templateKey}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    return this.recordPdfArchive(source.payment.id, actorUserId, {
      fileId: file.id,
      templateKey,
      departmentScope
    });
  }

  private async loadActorRoleKeys(
    tx: Parameters<PaymentRequestService["loadActorRoleScopes"]>[0], actorUserId: string, projectId: string
  ): Promise<RoleKey[]> {
    const roles = await this.loadActorRoleScopes(tx, actorUserId, projectId);
    return resolveEffectiveRoleKeys(roles.globalRoleKeys, roles.projectRoleKeys);
  }

  private async loadActorRoleScopes(
    tx: {
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    projectId: string
  ) {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const keys = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    return {
      globalRoleKeys: globalPositions.flatMap((position) => keys.get(position.positionId) ?? []),
      projectRoleKeys: [
        ...projectPositions.flatMap((position) => keys.get(position.positionId) ?? []),
        ...projectMembers.map((member) => member.positionKey as RoleKey)
      ]
    };
  }

  private formatCents(value: bigint) {
    return `${formatMoneyCentsAsYuan(dbMoneyToBigInt(value, "付款金额"))} CNY`;
  }

  private formatYuan(value: bigint) {
    return this.formatCents(value).replace(" CNY", "");
  }

  private async assignApproval(
    kind: PaymentApprovalAssignment["kind"],
    paymentId: string,
    actorUserId: string,
    input: DelegatePaymentApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("付款审批转交服务暂不可用，请稍后重试或联系管理员");
    }

    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("请选择有效的审批接收人，不能选择当前操作人");
    }

    let noticePaymentId: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      if (supportsApprovalReviewLock(tx)) await this.lockPaymentRequestForUpdate(tx, paymentId);
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      if (payment.status !== "approval_pending") {
        throw new Error("当前付款申请已离开审批中，不能转交或委托审批");
      }

      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ApprovalInstance" WHERE "businessType" = 'payment_request'
          AND "businessId" = ${payment.id} AND "flowType" = 'payment.approve'
          AND "status" = 'in_progress' FOR UPDATE
      `);

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          flowType: "payment.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的付款审批，请刷新后重试");
      }
      const parallel = isOrdinaryPaymentParallelRound(instance.frozenNodes);
      if (hasOrdinaryPaymentParallelMarker(instance.frozenNodes) && (!parallel || kind !== "delegate")) {
        throw new ConflictException("并联付款审批需按当前职责办理，原转审入口不支持该轮审批");
      }
      const nodeIndex = parallel ? input.expectedNodeIndex ?? -1 : instance.currentNodeIndex;
      if (parallel && (input.expectedApprovalInstanceId !== instance.id ||
          !activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex).includes(nodeIndex))) {
        throw new ConflictException("付款审批职责已变化，请刷新后重新确认委托");
      }
      if (!parallel && (input.expectedApprovalInstanceId !== undefined || input.expectedApprovalUpdatedAt !== undefined || input.expectedNodeIndex !== undefined || input.endsAt !== undefined)) {
        throw new ConflictException("当前付款审批轮次不支持按职责委托");
      }

      const nodes = instance.frozenNodes as unknown as PaymentApprovalNode[];
      const currentNode = nodes[nodeIndex];

      if (!currentNode) {
        throw new Error("当前付款审批节点异常，请刷新后重试");
      }

      const actorRoleScopes = parallel ? await this.loadActorRoleScopes(tx, actorUserId, payment.projectId) : undefined;
      const actorRoleKeys = actorRoleScopes
        ? resolveEffectiveRoleKeys(actorRoleScopes.globalRoleKeys, actorRoleScopes.projectRoleKeys)
        : await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      let identity = parallel
        ? resolveOrdinaryPaymentDuty(instance.frozenNodes, nodeIndex, { actorUserId, actorRoleKeys, actorRoleScopes }, true)
        : resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys });
      if (!identity && !parallel) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async (userId) => ({
          userId,
          roleKeys: await this.loadActorRoleKeys(tx, userId, payment.projectId)
        })));
        identity = resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys, activeDelegators });
      }
      if (parallel && (!identity || instance.applicantUserId === actorUserId || instance.applicantUserId === input.toUserId)) {
        throw new ForbiddenException("仅当前岗位审批人可以委托，申请人不能参与委托");
      }
      if (!identity) {
        throw new Error(`当前账号不能转交或委托“${currentNode.name}”付款审批节点`);
      }
      const fromRoleKey = identity.approvedRoleKey;
      await assertActiveApprovalRecipient(tx, input.toUserId);

      let scopedDelegation: {
        ordinaryPaymentDelegation: true; ordinaryPaymentDutyIndex: number; delegationActionId: string;
        startsAt: string; endsAt: string; expectedApprovalUpdatedAt: string;
      } | undefined;
      if (parallel) {
        const startsAt = new Date();
        const endsAt = new Date(input.endsAt ?? "");
        if (!input.endsAt || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(input.endsAt) ||
            !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
          throw new BadRequestException("委托截止时间必须晚于当前时间并包含时区");
        }
        const end = endsAt.toISOString();
        const expectedRevision = input.expectedApprovalUpdatedAt;
        if (typeof expectedRevision !== "string") throw new ConflictException("请刷新付款审批轮次后重新确认委托");
        if (currentNode.assignments?.some(assignment => assignment.kind === "delegate" &&
            assignment.fromUserId === actorUserId && assignment.fromRoleKey === fromRoleKey && assignment.toUserId === input.toUserId &&
            "endsAt" in assignment && assignment.endsAt === end &&
            "expectedApprovalUpdatedAt" in assignment && assignment.expectedApprovalUpdatedAt === expectedRevision)) return instance;
        if (expectedRevision !== instance.updatedAt.toISOString()) {
          throw new ConflictException("付款审批职责已变化，请刷新后重新确认委托");
        }
        scopedDelegation = {
          ordinaryPaymentDelegation: true, ordinaryPaymentDutyIndex: nodeIndex, delegationActionId: randomUUID(),
          startsAt: startsAt.toISOString(), endsAt: end, expectedApprovalUpdatedAt: expectedRevision
        };
      }
      const assignment = {
        kind, fromUserId: identity.representedUserId, fromRoleKey, toUserId: input.toUserId, ...scopedDelegation
      };
      const nextNodes = [...nodes];
      const nextAssignments = [
        ...(currentNode.assignments ?? []).filter(
          (assignment) =>
            !(
              assignment.kind === kind &&
              assignment.fromUserId === identity.representedUserId &&
              assignment.fromRoleKey === fromRoleKey
            )
        ),
        assignment
      ];
      nextNodes[nodeIndex] = { ...currentNode, assignments: nextAssignments };

      const updated = await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
          ...(scopedDelegation ? { updatedAt: new Date(Math.max(Date.now(), instance.updatedAt.getTime() + 1)) } : {})
        }
      });

      const assignmentAction = await tx.approvalActionLog.create({
        data: {
          ...(scopedDelegation ? { id: scopedDelegation.delegationActionId } : {}),
          approvalInstanceId: instance.id,
          action: kind,
          actorUserId,
          approvedRoleKey: fromRoleKey,
          representedUserId: identity.representedUserId,
          metadata: assignment
        }
      });

      if (scopedDelegation) {
        await this.approvalNotifications?.queue(tx, payment, updated, assignmentAction);
        noticePaymentId = payment.id;
      } else if (kind === "delegate") {
        const startsAt = new Date();
        await tx.approvalDelegation.create({
          data: {
            fromUserId: identity.representedUserId,
            toUserId: input.toUserId,
            startsAt,
            // ponytail: 临时台账窗口；全局委托管理上线后由其维护 endsAt。
            endsAt: new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000)
          }
        });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: `payment.approval.${kind}`,
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          nodeName: currentNode.name,
          fromRoleKey,
          toUserId: input.toUserId,
          ...(scopedDelegation ? { approvalInstanceId: instance.id, ...scopedDelegation } : {})
        }
      });

      return updated;
    });
    if (noticePaymentId) await this.approvalNotifications?.afterCommit(noticePaymentId);
    return result;
  }
}

function registeredPaymentResultUnconfirmed(idempotencyKey: string) {
  return new ConflictException({
    code: "PAYMENT_RESULT_UNCONFIRMED",
    resultStatus: "unconfirmed",
    idempotencyKey,
    message: "尚未确认实际付款登记结果，请保留原请求并先查询，不要重复登记"
  });
}

function paymentPrismaErrorCode(error: unknown): string | undefined {
  const sqlState = postgresSqlState(error);
  if (sqlState) return sqlState;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function requireApprovalCommentForReturn(decision: ReviewPaymentApprovalDto["decision"], comment?: string) {
  if (decision !== "approve" && !comment?.trim()) {
    throw new Error("请填写审批意见，说明驳回或退回原因");
  }
}

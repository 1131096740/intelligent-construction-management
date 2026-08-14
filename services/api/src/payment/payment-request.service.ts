import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  approvalElapsedHours,
  canCreatePaymentFromSettlementStatus,
  canRemindApproval,
  directPaymentAmountNature,
  isContractSettlementMode,
  SettlementStatus,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import {
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  assertActiveApprovalRecipient
} from "../approval/approval-review-identity";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import {
  lockApprovalReviewRow,
  supportsApprovalReviewLock
} from "../approval/approval-review-lock";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { ContractTakeoverBalanceService } from "../contract-takeover/contract-takeover-balance.service";
import {
  missingOperatingSourceReplayService,
  OperatingSourceReplayService
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
import type { AssignPaymentApprovalDto } from "./dto/assign-payment-approval.dto";
import type { AbandonPaymentRequestDto } from "./dto/abandon-payment-request.dto";
import type { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import type { GeneratePaymentPdfArchiveDto } from "./dto/generate-payment-pdf-archive.dto";
import type { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import type { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import type { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import type { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  type ContractTakeoverBalanceRow,
  toHistoricalContractPaymentBalance
} from "./contract-takeover-balance";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";
import { loadSettlementPaymentConfirmationFacts } from "./settlement-confirmation-facts";
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

const PAYMENT_POST_MONEY_FIELDS = [
  "requestedAmountCents",
  "approvedAmountCents",
  "paidAmountCents",
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
  id: string;
  code: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId?: string;
  paymentTermsStageId?: string | null;
  settlementId: string | null;
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
}

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
  voucherFileId: string;
}

type NormalizedCreatePaymentRequest = Omit<CreatePaymentRequestDto, "requestedAmountCents"> & {
  requestedAmountCents: bigint;
};

type AuditWriteClient = Pick<Prisma.TransactionClient, "auditLog">;

function positiveMoneyCents(value: string, message: string): bigint {
  const cents = parseMoneyCentsInput(value, "金额", message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function optionalTrimmedText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
    private readonly operatingSources: OperatingSourceReplayService =
      missingOperatingSourceReplayService()
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
      sourceType: "settlement" | "contract_advance" | "contract_due";
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
      if (takeover.takeoverLevel === "C") {
        await this.recordHistoricalTakeoverPaymentBlock(tx, {
          actorUserId: input.actorUserId,
          businessType: "contract_takeover",
          businessId: takeover.id,
          contractId: input.contractId,
          contractVersionId: input.contractVersionId,
          sourceType: input.sourceType,
          reason: "takeover_level_c",
          takeoverStatus: takeover.takeoverStatus
        });
        throw new BadRequestException(`C级历史接管仍有资料缺口或争议，不能${actionLabel}`);
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

    const payment = await this.prisma.$transaction(async (tx) => {
      const sourceType = normalizedInput.sourceType ?? "settlement";
      if (sourceType === "contract_advance") {
        return this.createContractAdvancePaymentRequest(tx, normalizedInput, applicantUserId);
      }

      if (sourceType === "contract_due") {
        return this.createContractDuePaymentRequest(tx, normalizedInput, applicantUserId);
      }

      if (sourceType !== "settlement") {
        throw new Error("不支持的付款申请来源，请从结算或合同付款入口发起");
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
      const payment = await tx.paymentRequest.create({
        data: {
          projectId: settlement.projectId,
          settlementId: settlement.id,
          sourceType: "settlement",
          paymentSubjectType: "our_company",
          contractId: settlement.contractId,
          contractVersionId: settlement.contractVersionId,
          paymentTermsVersionId: settlement.paymentTermsVersionId,
          code: normalizedInput.code,
          status: "approval_pending",
          requestedAmountCents: normalizedInput.requestedAmountCents,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      });

      if (applicantUserId) {
        await tx.approvalInstance.create({
          data: {
            flowType: "payment.approve",
            businessType: "payment_request",
            businessId: payment.id,
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: PAYMENT_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
            applicantUserId
          }
        });
      }

      await this.recordPaymentRequestCreated(tx, payment, applicantUserId);
      return payment;
    });

    return paymentPostResponseToApi(payment);
  }

  private async createContractDuePaymentRequest(
    tx: Prisma.TransactionClient,
    input: NormalizedCreatePaymentRequest,
    applicantUserId?: string
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
        amountLimitType: true,
        effectiveAt: true,
        settlementMode: true,
        settlementModeConfirmedAt: true
      }
    });
    if (!contractVersion) {
      throw new Error("未找到合同版本，请刷新合同台账后重试");
    }
    if (contractVersion.status !== "effective") {
      throw new Error("当前合同尚未归档生效，不能发起付款申请");
    }
    const contract = await tx.contract.findUnique({
      where: { id: contractVersion.contractId },
      select: { projectId: true, contractTypeKey: true }
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
    if (!input.paymentTermsStageId) {
      throw new Error("请选择合同已冻结的付款阶段");
    }
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: contractVersion.contractId,
      contractVersionId: contractVersion.id,
      sourceType: "contract_due",
      actorUserId: applicantUserId
    });

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

    const paymentTermsStage = await tx.paymentTermsStage.findUnique({
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
    });
    this.assertGenericContractPaymentStage(paymentTermsStage, paymentTermsVersion.id);
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
      amountNature === "unlimited_total" &&
      (paymentMatter === null || amountCalculationExplanation === null)
    ) {
      throw new BadRequestException(
        "无固定总价合同必须填写本次付款事项和金额计算说明"
      );
    }

    await this.assertGenericContractPaymentStageCapacity(
      tx,
      contractVersion,
      paymentTermsStage!,
      input.requestedAmountCents
    );
    const payment = await tx.paymentRequest.create({
      data: {
        projectId: contract.projectId,
        settlementId: null,
        sourceType: "contract_due",
        paymentSubjectType: "our_company",
        contractId: contractVersion.contractId,
        contractVersionId: contractVersion.id,
        paymentTermsVersionId: paymentTermsVersion.id,
        paymentTermsStageId: paymentTermsStage!.id,
        code: input.code,
        status: "approval_pending",
        requestedAmountCents: input.requestedAmountCents,
        approvedAmountCents: null,
        paidAmountCents: 0n,
        ...(paymentMatter === null || amountCalculationExplanation === null
          ? {}
          : { paymentMatter, amountCalculationExplanation })
      }
    });

    if (applicantUserId) {
      await tx.approvalInstance.create({
        data: {
          flowType: "payment.approve",
          businessType: "payment_request",
          businessId: payment.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: PAYMENT_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
          applicantUserId
        }
      });
    }

    await this.recordPaymentRequestCreated(tx, payment, applicantUserId);
    return payment;
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

  private async assertGenericContractPaymentStageCapacity(
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
    },
    requestedAmountCents: bigint
  ): Promise<void> {
    await this.lockContractAdvancePaymentRows(tx, contractVersion.contractId);
    const effectiveAt = contractVersion.effectiveAt;
    if (!effectiveAt) {
      throw new BadRequestException("合同生效日期缺失，不能核算冻结付款阶段");
    }
    const dueAt = new Date(
      effectiveAt.getTime() + Math.max(stage.dueDays, 0) * 24 * 60 * 60 * 1000
    );
    const amountNature = directPaymentAmountNature(contractVersion);
    if (amountNature === "unlimited_total") {
      if (dueAt > new Date() && !stage.allowsEarlyPayment) {
        throw new BadRequestException(
          "合同冻结付款阶段尚未到期，不能提前发起付款申请"
        );
      }
      return;
    }
    const contractAmountCents = dbMoneyToBigInt(contractVersion.amountCents, "合同金额");
    const configuredAmountCents = stage.fixedAmountCents !== null
      ? dbMoneyToBigInt(stage.fixedAmountCents, "付款阶段固定金额")
      : (contractAmountCents * BigInt(Math.max(stage.ratioBps ?? 0, 0))) / 10000n;
    const stagePayableCents = dueAt <= new Date() || stage.allowsEarlyPayment
      ? (configuredAmountCents < contractAmountCents ? configuredAmountCents : contractAmountCents)
      : 0n;
    const occupiedRequests = await tx.paymentRequest.findMany({
      where: {
        contractId: contractVersion.contractId,
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
    const occupiedCents = occupiedRequests
      .filter((request) => request.paymentTermsStageId === stage.id)
      .reduce(
      (total, request) =>
        total + requestOccupiedCents(request),
      0n
    );
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
    const stageRemainingCents = stagePayableCents - occupiedCents;
    const contractRemainingCents =
      contractAmountCents - allStageOccupiedCents - proxyPaidCents - historicalOccupiedCents;
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

  private async createContractAdvancePaymentRequest(
    tx: Prisma.TransactionClient,
    input: NormalizedCreatePaymentRequest,
    applicantUserId?: string
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
        effectiveAt: true
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
      throw new Error(
        `合同预付款当前可申请金额不足，当前最多可申请 ${formatMoneyCentsAsYuan(
          capacity.remainingCents > 0n ? capacity.remainingCents : 0n
        )} 元`
      );
    }

    const payment = await tx.paymentRequest.create({
      data: {
        projectId: contract.projectId,
        settlementId: null,
        sourceType: "contract_advance",
        paymentSubjectType: "our_company",
        contractId: contractVersion.contractId,
        contractVersionId: contractVersion.id,
        paymentTermsVersionId: paymentTermsVersion.id,
        code: input.code,
        status: "approval_pending",
        requestedAmountCents: input.requestedAmountCents,
        approvedAmountCents: null,
        paidAmountCents: 0n
      }
    });

    if (applicantUserId) {
      await tx.approvalInstance.create({
        data: {
          flowType: "payment.approve",
          businessType: "payment_request",
          businessId: payment.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: PAYMENT_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
          applicantUserId
        }
      });
    }

    await this.recordPaymentRequestCreated(tx, payment, applicantUserId);
    return payment;
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

    return sumMoneyCents(payments.map((payment) => payment.amountCents));
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

    return sumMoneyCents(payments.map((payment) => payment.amountCents));
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
        payment."contractVersionId",
        payment."paymentTermsVersionId",
        payment."paymentTermsStageId",
        payment."settlementId",
        payment."sourceType",
        payment."updatedAt",
        payment."paymentSubjectType",
        payment."status",
        payment."requestedAmountCents",
        payment."approvedAmountCents",
        payment."paidAmountCents",
        version."signingSubjectType",
        version."companyEntityIdSnapshot",
        version."companyEntityNameSnapshot",
        version."companyEntityCreditCodeSnapshot"
      FROM "PaymentRequest" payment
      INNER JOIN "ContractVersion" version
        ON version."id" = payment."contractVersionId"
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

  // 申请人撤回进行中的付款审批：付款请求无草稿态，撤回为终态 withdrawn（重试须新建付款申请）。
  async withdrawApproval(paymentId: string, actorUserId: string) {
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

      const updated = await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { status: "withdrawn" }
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
          toStatus: "withdrawn",
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
      }>>(Prisma.sql`
        SELECT "id", "status", "applicantUserId"
        FROM "ApprovalInstance"
        WHERE "businessType" = 'payment_request'
          AND "businessId" = ${payment.id}
          AND "flowType" = 'payment.approve'
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 1
        FOR UPDATE
      `);
      const latestApproval = approvalRows[0];
      if (!latestApproval || latestApproval.status !== "returned_to_applicant") {
        throw new ConflictException("付款申请没有有效的退回待修改审批记录，不能放弃申请");
      }
      if (latestApproval.applicantUserId !== actorUserId) {
        throw new ForbiddenException("只有当前付款申请人可以放弃申请");
      }

      const returnAction = await tx.approvalActionLog.findFirst({
        where: {
          approvalInstanceId: latestApproval.id,
          action: "return_to_applicant"
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
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前付款审批节点异常，请刷新后重试");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      const identityNode = input.decision === "approve"
        ? currentNode
        : { ...currentNode, approvedRoleKeys: [] };
      let identity = resolveApprovalReviewIdentity({
        node: identityNode,
        actorUserId,
        actorRoleKeys
      });
      if (!identity) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async (userId) => ({
          userId,
          roleKeys: await this.loadActorRoleKeys(tx, userId, payment.projectId)
        })));
        identity = resolveApprovalReviewIdentity({ node: identityNode, actorUserId, actorRoleKeys, activeDelegators });
      }
      if (!identity) {
        throw new ForbiddenException(`当前账号不能处理“${currentNode.name}”付款审批节点`);
      }
      const approvedRoleKey = identity.approvedRoleKey;

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
        input.expectedNodeIndex !== instance.currentNodeIndex ||
        !(instance.updatedAt instanceof Date) ||
        instance.updatedAt.getTime() !== expectedApprovalUpdatedAt.getTime()
      ) {
        throw new ConflictException("付款审批坐标已变化，请刷新页面后重试");
      }

      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: input.decision === "approve" && isGovernedFrozenApprovalNode(currentNode)
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

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: {
            currentNodeIndex: previousNodeIndex,
            frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
            status: "in_progress"
          }
        });

        await tx.approvalActionLog.create({
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

        return updated;
      }

      if (input.decision === "return_to_applicant") {
        const updated = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: { status: "draft" }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "returned_to_applicant" }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "return_to_applicant",
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
            ...selfReview.metadata
          }
        });

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
        await tx.approvalActionLog.create({
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
      nextNodes[instance.currentNodeIndex] = nextNode;

      const nodeCompleted =
        nextNode.mode === "any" || nextNode.roleKeys.every((role) => approvedRoleKeys.has(role));
      const nextNodeIndex = nodeCompleted ? instance.currentNodeIndex + 1 : instance.currentNodeIndex;
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
        (
          payerFacts.paymentSubjectType !== "our_company" ||
          payerFacts.signingSubjectType !== "our_company" ||
          !payerFacts.companyEntityIdSnapshot?.trim() ||
          !payerFacts.companyEntityNameSnapshot?.trim() ||
          !payerFacts.companyEntityCreditCodeSnapshot?.trim()
        )
      ) {
        throw new BadRequestException(
          "付款合同不是完整的我方付款主体，不能完成付款审批"
        );
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
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: nextNodeIndex,
          frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
          status: flowCompleted ? "approved" : "in_progress"
        }
      });
      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          comment: input.comment?.trim() || undefined,
          approvedRoleKey,
          representedUserId: identity.representedUserId,
          ...(isGovernedFrozenApprovalNode(currentNode)
            ? {
                signatureFileIdSnapshot: signature.fileId,
                signatureSha256Snapshot: signature.sha256,
                signatureVersionIdSnapshot: signature.versionId
              }
            : {}),
          ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
        }
      });
      if (flowCompleted) {
        await this.shrinkFinancingQuotaUsageToApprovedAmount(
          tx,
          payment,
          approvedAmountCents,
          actorUserId
        );
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
          ...selfReview.metadata
        }
      });
      if (flowCompleted) {
        completedInstanceId = instance.id;
      }
      return approved;
    });

    if (completedInstanceId) {
      await this.approvalForms
        ?.generateForInstance(completedInstanceId, actorUserId)
        .catch(() => undefined);
    }

    return result;
  }

  transferApproval(paymentId: string, actorUserId: string, input: AssignPaymentApprovalDto) {
    return this.assignApproval("transfer", paymentId, actorUserId, input);
  }

  delegateApproval(paymentId: string, actorUserId: string, input: AssignPaymentApprovalDto) {
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

  async recordExecution(
    paymentId: string,
    actorUserId: string,
    input: RecordPaymentExecutionDto
  ) {
    if (!this.prisma) {
      throw new Error("付款实付登记服务暂不可用，请稍后重试或联系管理员");
    }
    if (!this.files || !this.projectFunding) {
      throw new Error("付款实付登记依赖服务暂不可用，请稍后重试或联系管理员");
    }

    const amountCents = positiveMoneyCents(input.amountCents, "实付金额必须大于 0");
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

    const voucherFileId = input.voucherFileId?.trim();
    if (!voucherFileId) {
      throw new Error("登记实付必须上传付款凭证");
    }

    if (!input.confirmationPassword?.trim()) {
      throw new Error("登记实付需要当前登录密码确认");
    }

    const paidAt = new Date(input.paidAt);
    if (Number.isNaN(paidAt.getTime())) {
      throw new Error("实付日期格式不正确，请重新选择实付日期");
    }
    if (paidAt.getTime() > Date.now()) {
      throw new Error("实付日期不能晚于当前时间");
    }

    if (!this.auth) {
      throw new Error("登记实付确认服务暂不可用，请稍后重试或联系管理员");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    const files = this.files;
    const projectFunding = this.projectFunding;

    try {
      const execution = await this.prisma.$transaction(async (tx) => {
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
        await projectFunding.lockFundingContext(tx, fundingScope.projectId);

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
        await this.assertCurrentProjectFinanceStaff(
          tx,
          actorUserId,
          payment.projectId
        );
        if (payment.signingSubjectType === "affiliate") {
          throw new BadRequestException(
            "该合同冻结为挂靠企业签约，不能创建或登记我方付款"
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
        if (existingExecution) {
          this.assertSamePaymentExecutionFacts(existingExecution, {
            idempotencyKey,
            paymentRequestId: payment.id,
            settlementId: payment.settlementId,
            amountCents,
            paidAt,
            actorUserId,
            voucherFileId,
            companyEntityIdSnapshot,
            companyEntityNameSnapshot,
            companyEntityCreditCodeSnapshot
          });
          await projectFunding.allocateExecution(tx, {
            projectId: payment.projectId,
            executionType: "payment_execution",
            executionId: existingExecution.id,
            businessType: "payment_request",
            businessId: payment.id,
            amountCents,
            occurredAt: paidAt,
            actorUserId
          });
          await this.appendOperatingPaymentExecution(
            tx,
            payment.projectId,
            existingExecution.id,
            actorUserId
          );
          return existingExecution;
        }

        if (payment.updatedAt.getTime() !== expectedPaymentUpdatedAt.getTime()) {
          throw new ConflictException("付款申请已变化，请刷新后重试");
        }

        if (!["approved_pending_payment", "partially_paid"].includes(payment.status)) {
          throw new Error(this.paymentExecutionBlockedMessage(payment.status));
        }

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
          throw new Error(
            `实付金额超过付款申请剩余可实付金额，当前最多可实付 ${this.formatYuan(
              remainingAmountCents > 0n ? remainingAmountCents : 0n
            )} 元`
          );
        }

        const newPaymentPaidAmountCents = payment.paidAmountCents + amountCents;
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
        const lockedVoucher = await files.assertFileHasNoBusinessBinding(
          tx,
          voucherFileId
        );
        if (lockedVoucher.uploadedByUserId !== actorUserId) {
          throw new ForbiddenException("付款凭证必须由当前登记人上传");
        }

        const execution = await paymentExecutionClient.create({
          data: {
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
            voucherFileId
          }
        });
        const fundingAllocation = await projectFunding.allocateExecution(tx, {
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
            voucherFileId,
            idempotencyKey,
            payer: {
              paymentSubjectType: "our_company",
              companyEntityIdSnapshot,
              companyEntityNameSnapshot,
              companyEntityCreditCodeSnapshot
            },
            funding: {
              kind: fundingAllocation.kind,
              projectCashAmountCents: moneyCentsToApi(
                fundingAllocation.projectCashAmountCents
              ),
              financingQuotaAmountCents: moneyCentsToApi(
                fundingAllocation.financingQuotaAmountCents
              ),
              allocations: fundingAllocation.allocations.map((allocation) => ({
                sourceType: allocation.sourceType,
                sourceId: allocation.sourceId,
                amountCents: moneyCentsToApi(allocation.amountCents)
              }))
            },
            fromStatus: payment.status,
            toStatus: newPaymentStatus
          }
        });

        return execution;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });

      return paymentPostResponseToApi(execution);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = paymentPrismaErrorCode(error);
      if (code === "P2002" || code === "P2034") {
        const concurrentExecution = await this.resolveConcurrentPaymentExecution({
          paymentId,
          actorUserId,
          idempotencyKey,
          amountCents,
          paidAt,
          voucherFileId
        });
        if (concurrentExecution) {
          return paymentPostResponseToApi(concurrentExecution);
        }
        throw new ConflictException(
          code === "P2034"
            ? "实际付款并发冲突，请刷新后重试"
            : "实际付款唯一事实已变化，请刷新后重试"
        );
      }
      throw error;
    }
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
      existing.voucherFileId !== expected.voucherFileId
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
  }): Promise<PaymentExecutionFactRow | null> {
    if (!this.prisma) return null;
    const executionClient = this.prisma.paymentExecution as unknown as {
      findUnique(args: {
        where: { idempotencyKey: string };
      }): Promise<PaymentExecutionFactRow | null>;
    };
    const existing = await executionClient.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    });
    if (!existing) return null;

    const payment = await this.prisma.paymentRequest.findFirst({
      where: {
        OR: [{ id: input.paymentId }, { code: input.paymentId }]
      },
      select: {
        id: true,
        settlementId: true,
        contractVersionId: true,
        paymentSubjectType: true
      }
    });
    if (!payment || payment.paymentSubjectType !== "our_company") return null;
    const version = await this.prisma.contractVersion.findUnique({
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
      return null;
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
      companyEntityCreditCodeSnapshot
    });
    return existing;
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
      return financeRecord;
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
    tx: {
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
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
    const positionKeys = positions.map((position) => position.key as RoleKey);
    const memberKeys = projectMembers.map((member) => member.positionKey as RoleKey);

    return Array.from(new Set([...positionKeys, ...memberKeys]));
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
    input: AssignPaymentApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("付款审批转交服务暂不可用，请稍后重试或联系管理员");
    }

    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("请选择有效的审批接收人，不能选择当前操作人");
    }

    return this.prisma.$transaction(async (tx) => {
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

      const nodes = instance.frozenNodes as unknown as PaymentApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前付款审批节点异常，请刷新后重试");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      let identity = resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys });
      if (!identity) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async (userId) => ({
          userId,
          roleKeys: await this.loadActorRoleKeys(tx, userId, payment.projectId)
        })));
        identity = resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys, activeDelegators });
      }
      if (!identity) {
        throw new Error(`当前账号不能转交或委托“${currentNode.name}”付款审批节点`);
      }
      const fromRoleKey = identity.approvedRoleKey;
      await assertActiveApprovalRecipient(tx, input.toUserId);

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
        { kind, fromUserId: identity.representedUserId, fromRoleKey, toUserId: input.toUserId }
      ];
      nextNodes[instance.currentNodeIndex] = { ...currentNode, assignments: nextAssignments };

      const updated = await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { frozenNodes: nextNodes as unknown as Prisma.InputJsonValue }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: kind,
          actorUserId,
          approvedRoleKey: fromRoleKey,
          representedUserId: identity.representedUserId,
          metadata: {
            kind,
            fromUserId: identity.representedUserId,
            toUserId: input.toUserId,
            fromRoleKey
          }
        }
      });

      if (kind === "delegate") {
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
          toUserId: input.toUserId
        }
      });

      return updated;
    });
  }
}

function paymentPrismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (code === "P2010") {
    const meta = (error as { meta?: unknown }).meta;
    if (meta && typeof meta === "object") {
      const postgresCode = (meta as { code?: unknown }).code;
      if (["40001", "40P01"].includes(String(postgresCode))) {
        return "P2034";
      }
    }
  }
  if (code === "40P01") return "P2034";
  return typeof code === "string" ? code : undefined;
}

function requireApprovalCommentForReturn(decision: ReviewPaymentApprovalDto["decision"], comment?: string) {
  if (decision !== "approve" && !comment?.trim()) {
    throw new Error("请填写审批意见，说明驳回或退回原因");
  }
}

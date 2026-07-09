import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  approvalElapsedHours,
  canCreatePaymentFromSettlementStatus,
  canRemindApproval,
  SettlementStatus,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { renderSimplePdf } from "../pdf/simple-pdf";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  type ContractTakeoverBalanceRow,
  toHistoricalContractPaymentBalance
} from "./contract-takeover-balance";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";
import {
  allocateContractDuePaymentExecution,
  buildContractPaymentApplicationPreview,
  calculateContractAdvancePaymentCapacity,
  calculateContractDuePaymentCapacity,
  calculateSettlementPaymentCapacity,
  CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES,
  SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
  sumSafeCents
} from "./settlement-payment-capacity";

interface AssignApprovalDto {
  toUserId: string;
}

interface GeneratePaymentPdfArchiveDto {
  templateKey?: string;
  departmentScope?: string;
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
}

interface PaymentExecutionLockRow {
  id: string;
  code: string;
  projectId: string;
  contractId: string;
  settlementId: string | null;
  sourceType?: string;
  status: string;
  requestedAmountCents: number;
  approvedAmountCents: number | null;
  paidAmountCents: number;
}

type AuditWriteClient = Pick<Prisma.TransactionClient, "auditLog">;

const PAYMENT_APPROVAL_NODES = [
  {
    name: "项目经理",
    mode: "any",
    roleKeys: ["project_manager"]
  },
  {
    name: "合同结算部/预算部",
    mode: "any",
    roleKeys: ["contract_director", "budget_director"]
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
const PROJECT_FINANCING_USAGE_ACTIVE_STATUSES = ["occupied", "used"] as const;

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
    private readonly approvalForms?: ApprovalFormService
  ) {}

  assertSettlementEffective(status: SettlementStatus): void {
    if (!canCreatePaymentFromSettlementStatus(status)) {
      throw new Error("Cannot create payment request from a non-effective settlement");
    }
  }

  assertRequestAllowed(
    status: SettlementStatus,
    capacity: PaymentCapacity,
    requestedAmountCents: number
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
    }
  ) {
    const takeoverClient = (tx as unknown as {
      contractTakeover?: {
        findUnique(args: {
          where: { contractVersionId: string };
          select: {
            id: true;
            takeoverStatus: true;
            historicalBalanceConfirmedAt: true;
          };
        }): Promise<{
          id: string;
          takeoverStatus: string;
          historicalBalanceConfirmedAt: Date | null;
        } | null>;
      };
    }).contractTakeover;
    const takeover = takeoverClient
      ? await takeoverClient.findUnique({
          where: { contractVersionId: input.contractVersionId },
          select: {
            id: true,
            takeoverStatus: true,
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
        throw new Error("Historical contract takeover must be confirmed before creating payment request");
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
        throw new Error("Historical balance must be confirmed before creating payment request");
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
      throw new Error("Historical contract takeover must be confirmed before creating payment request");
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
      requestedAmountCents: number;
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
        requestedAmountCents: payment.requestedAmountCents
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
      throw new Error("Prisma service is required to create payment request");
    }

    return this.prisma.$transaction(async (tx) => {
      const sourceType = input.sourceType ?? "settlement";
      if (sourceType === "contract_advance") {
        return this.createContractAdvancePaymentRequest(tx, input, applicantUserId);
      }

      if (sourceType === "contract_due") {
        return this.createContractDuePaymentRequest(tx, input, applicantUserId);
      }

      if (sourceType !== "settlement") {
        throw new Error(`Unsupported payment request source type: ${sourceType}`);
      }

      if (!input.settlementId) {
        throw new Error("Settlement is required for settlement payment request");
      }

      let settlement = await tx.settlement.findUnique({
        where: { id: input.settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      this.assertSettlementEffective(settlement.status as SettlementStatus);
      await this.lockContractPaymentCapacityRows(tx, settlement.contractId);
      settlement = await tx.settlement.findUnique({
        where: { id: settlement.id }
      });
      if (!settlement) {
        throw new Error("Settlement not found");
      }
      this.assertSettlementEffective(settlement.status as SettlementStatus);
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
      const capacityView = calculateSettlementPaymentCapacity({
        payableAmountCents: settlement.payableAmountCents,
        actualPaidAmountCents: settlement.paidAmountCents,
        proxyPaidAmountCents: proxyPaidCents + contractDueAllocatedCents,
        paymentRequests: existingApprovedOrPending
      });
      const capacity: PaymentCapacity = {
        payableAmountCents: settlement.payableAmountCents,
        approvedPendingPaymentCents: capacityView.outstandingPaymentCents,
        paidAmountCents: settlement.paidAmountCents + proxyPaidCents + contractDueAllocatedCents
      };

      this.amount.assertCanRequest(capacity, input.requestedAmountCents);
      await this.assertContractDuePaymentCapacity(tx, settlement, input.requestedAmountCents);
      const financingQuotaAllocations = await this.reserveProjectCashPool(
        tx,
        settlement.projectId,
        input.requestedAmountCents
      );

      const payment = await tx.paymentRequest.create({
        data: {
          projectId: settlement.projectId,
          settlementId: settlement.id,
          sourceType: "settlement",
          contractId: settlement.contractId,
          contractVersionId: settlement.contractVersionId,
          paymentTermsVersionId: settlement.paymentTermsVersionId,
          code: input.code,
          status: "approval_pending",
          requestedAmountCents: input.requestedAmountCents,
          approvedAmountCents: null,
          paidAmountCents: 0
        }
      });

      if (financingQuotaAllocations.length) {
        await tx.projectFinancingQuotaUsage.createMany({
          data: financingQuotaAllocations.map((allocation) => ({
            quotaId: allocation.quotaId,
            paymentRequestId: payment.id,
            projectId: settlement.projectId,
            amountCents: allocation.amountCents,
            status: "occupied"
          }))
        });

        if (applicantUserId) {
          await this.audit.record(tx, {
            actorUserId: applicantUserId,
            action: "payment.financing_quota.occupy",
            businessType: "payment_request",
            businessId: payment.id,
            metadata: {
              projectId: settlement.projectId,
              allocations: financingQuotaAllocations.map((allocation) => ({
                quotaId: allocation.quotaId,
                amountCents: allocation.amountCents.toString()
              }))
            }
          });
        }
      }

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
  }

  private async createContractDuePaymentRequest(
    tx: Prisma.TransactionClient,
    input: CreatePaymentRequestDto,
    applicantUserId?: string
  ) {
    if (input.settlementId) {
      throw new Error("Settlement must not be provided for contract due payment request");
    }

    if (!input.contractVersionId) {
      throw new Error("Contract version is required for contract due payment request");
    }

    const contractVersion = await tx.contractVersion.findUnique({
      where: { id: input.contractVersionId },
      select: {
        id: true,
        contractId: true,
        status: true
      }
    });
    if (!contractVersion) {
      throw new Error("Contract version not found");
    }
    if (contractVersion.status !== "effective") {
      throw new Error("Cannot create contract due payment from a non-effective contract version");
    }
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: contractVersion.contractId,
      contractVersionId: contractVersion.id,
      sourceType: "contract_due",
      actorUserId: applicantUserId
    });

    const contract = await tx.contract.findUnique({
      where: { id: contractVersion.contractId },
      select: { projectId: true }
    });
    if (!contract) {
      throw new Error("Contract not found");
    }

    const paymentTermsVersion = await tx.paymentTermsVersion.findFirst({
      where: {
        ...(input.paymentTermsVersionId ? { id: input.paymentTermsVersionId } : {}),
        contractVersionId: contractVersion.id,
        status: "effective"
      },
      orderBy: { versionNo: "desc" }
    });
    if (!paymentTermsVersion) {
      throw new Error("Effective payment terms version not found");
    }

    if (!Number.isInteger(input.requestedAmountCents) || input.requestedAmountCents <= 0) {
      throw new Error("付款申请金额必须为大于 0 的整数分");
    }

    await this.assertContractDuePaymentCapacityForContract(
      tx,
      contractVersion.contractId,
      paymentTermsVersion.id,
      input.requestedAmountCents
    );
    const financingQuotaAllocations = await this.reserveProjectCashPool(
      tx,
      contract.projectId,
      input.requestedAmountCents
    );

    const payment = await tx.paymentRequest.create({
      data: {
        projectId: contract.projectId,
        settlementId: null,
        sourceType: "contract_due",
        contractId: contractVersion.contractId,
        contractVersionId: contractVersion.id,
        paymentTermsVersionId: paymentTermsVersion.id,
        code: input.code,
        status: "approval_pending",
        requestedAmountCents: input.requestedAmountCents,
        approvedAmountCents: null,
        paidAmountCents: 0
      }
    });

    if (financingQuotaAllocations.length) {
      await tx.projectFinancingQuotaUsage.createMany({
        data: financingQuotaAllocations.map((allocation) => ({
          quotaId: allocation.quotaId,
          paymentRequestId: payment.id,
          projectId: contract.projectId,
          amountCents: allocation.amountCents,
          status: "occupied"
        }))
      });

      if (applicantUserId) {
        await this.audit.record(tx, {
          actorUserId: applicantUserId,
          action: "payment.financing_quota.occupy",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            projectId: contract.projectId,
            allocations: financingQuotaAllocations.map((allocation) => ({
              quotaId: allocation.quotaId,
              amountCents: allocation.amountCents.toString()
            }))
          }
        });
      }
    }

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

  private async createContractAdvancePaymentRequest(
    tx: Prisma.TransactionClient,
    input: CreatePaymentRequestDto,
    applicantUserId?: string
  ) {
    if (!input.contractVersionId) {
      throw new Error("Contract version is required for contract advance payment request");
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
      throw new Error("Contract version not found");
    }
    if (contractVersion.status !== "effective") {
      throw new Error("Cannot create contract advance payment from a non-effective contract version");
    }
    if (!contractVersion.effectiveAt) {
      throw new Error("Contract effective date is required for contract advance payment request");
    }
    await this.assertHistoricalTakeoverPaymentReady(tx, {
      contractId: contractVersion.contractId,
      contractVersionId: contractVersion.id,
      sourceType: "contract_advance",
      actorUserId: applicantUserId
    });

    const contract = await tx.contract.findUnique({
      where: { id: contractVersion.contractId },
      select: { projectId: true }
    });
    if (!contract) {
      throw new Error("Contract not found");
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
      throw new Error("Effective payment terms version not found");
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
    const capacity = calculateContractAdvancePaymentCapacity({
      asOf: new Date(),
      contractAmountCents: sumSafeCents([contractVersion.amountCents]),
      contractEffectiveAt: contractVersion.effectiveAt,
      paymentTermsStages,
      paymentRequests: existingAdvancePayments,
      historicalBalance
    });

    if (!Number.isInteger(input.requestedAmountCents) || input.requestedAmountCents <= 0) {
      throw new Error("付款申请金额必须为大于 0 的整数分");
    }
    if (input.requestedAmountCents > capacity.remainingCents) {
      throw new Error(`合同预付款到期可付额度不足: ${Math.max(capacity.remainingCents, 0)}`);
    }

    const financingQuotaAllocations = await this.reserveProjectCashPool(
      tx,
      contract.projectId,
      input.requestedAmountCents
    );

    const payment = await tx.paymentRequest.create({
      data: {
        projectId: contract.projectId,
        settlementId: null,
        sourceType: "contract_advance",
        contractId: contractVersion.contractId,
        contractVersionId: contractVersion.id,
        paymentTermsVersionId: paymentTermsVersion.id,
        code: input.code,
        status: "approval_pending",
        requestedAmountCents: input.requestedAmountCents,
        approvedAmountCents: null,
        paidAmountCents: 0
      }
    });

    if (financingQuotaAllocations.length) {
      await tx.projectFinancingQuotaUsage.createMany({
        data: financingQuotaAllocations.map((allocation) => ({
          quotaId: allocation.quotaId,
          paymentRequestId: payment.id,
          projectId: contract.projectId,
          amountCents: allocation.amountCents,
          status: "occupied"
        }))
      });

      if (applicantUserId) {
        await this.audit.record(tx, {
          actorUserId: applicantUserId,
          action: "payment.financing_quota.occupy",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            projectId: contract.projectId,
            allocations: financingQuotaAllocations.map((allocation) => ({
              quotaId: allocation.quotaId,
              amountCents: allocation.amountCents.toString()
            }))
          }
        });
      }
    }

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
      amountCents: number;
      paymentTermsVersionId: string;
    },
    requestedAmountCents: number
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
    requestedAmountCents: number
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
            fixedAmountCents: number | null;
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
      throw new Error("合同到期可付额度不足: 0");
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
        paymentTermsStageClient.settlementArchiveFile.findMany({
          where: {
            settlementId: { in: settlementIds },
            status: "confirmed",
            confirmedAt: { not: null }
          },
          select: { settlementId: true, confirmedAt: true }
        }),
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

    const capacity = calculateContractDuePaymentCapacity({
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

    if (requestedAmountCents > capacity.remainingCents) {
      throw new Error(`合同到期可付额度不足: ${Math.max(capacity.remainingCents, 0)}`);
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
      amountCents: number;
      contractVersionId?: string;
      paymentTermsVersionId: string;
    }>
  ): Promise<Record<string, number | bigint>> {
    const contractVersionClient = (tx as unknown as {
      contractVersion?: {
        findMany: (args: {
          where: { id: { in: string[] } };
          select: { id: true; amountCents: true };
        }) => Promise<Array<{ id: string; amountCents: number | bigint }>>;
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
        : new Map<string, number>();

    const fallbackAmountCents = sumSafeCents(contractSettlements.map((settlement) => settlement.amountCents));
    const amountByTermsId: Record<string, number | bigint> = {};
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

  private async reserveProjectCashPool(
    tx: Prisma.TransactionClient,
    projectId: string,
    requestedAmountCents: number
  ): Promise<Array<{ quotaId: string; amountCents: bigint }>> {
    const lockedProjects = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
      SELECT "id", "isActive"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `);
    if (!lockedProjects[0]?.isActive) {
      throw new BadRequestException("Project is inactive");
    }

    const projectExpenseRequestClient = (tx as unknown as {
      projectExpenseRequest?: {
        findMany: (args: {
          where: { projectId: string; status: { in: string[] }; voidedAt: null };
          select: {
            status: true;
            requestedAmountCents: true;
            approvedAmountCents: true;
            paidAmountCents: true;
          };
        }) => Promise<
          Array<{
            status: string;
            requestedAmountCents: number;
            approvedAmountCents: number | null;
            paidAmountCents: number;
          }>
        >;
      };
    }).projectExpenseRequest;
    const projectExpenseFinancingUsageClient = (tx as unknown as {
      projectExpenseFinancingQuotaUsage?: {
        findMany: (args: {
          where: { quotaId: { in: string[] }; status: { in: string[] } };
          select: { quotaId: true; amountCents: true };
        }) => Promise<Array<{ quotaId: string; amountCents: bigint | number }>>;
      };
    }).projectExpenseFinancingQuotaUsage;

    const [projectReceipts, projectPayments, projectExpenseRequests, financingQuotas] = await Promise.all([
      tx.projectReceipt.findMany({
        where: { projectId, voidedAt: null },
        select: { amountCents: true }
      }),
      tx.paymentRequest.findMany({
        where: {
          projectId,
          status: { in: [...PROJECT_CASH_POOL_PAYMENT_STATUSES] }
        },
        select: {
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      projectExpenseRequestClient
        ? projectExpenseRequestClient.findMany({
            where: {
              projectId,
              status: { in: [...PROJECT_CASH_POOL_PAYMENT_STATUSES] },
              voidedAt: null
            },
            select: {
              status: true,
              requestedAmountCents: true,
              approvedAmountCents: true,
              paidAmountCents: true
            }
          })
        : Promise.resolve([]),
      tx.projectFinancingQuota.findMany({
        where: {
          projectId,
          status: "approved",
          validUntil: { gte: new Date() }
        },
        select: { id: true, amountCents: true },
        orderBy: { validUntil: "asc" }
      })
    ]);

    const actualReceiptsCents = sumSafeCents(
      projectReceipts.map((receipt) => receipt.amountCents)
    );
    const actualPaidCents =
      sumSafeCents(projectPayments.map((payment) => payment.paidAmountCents)) +
      sumSafeCents(projectExpenseRequests.map((request) => request.paidAmountCents));
    const occupiedCents = sumSafeCents(
      [
        ...projectPayments.map((payment) => projectCashPoolOutstandingCents(payment)),
        ...projectExpenseRequests.map((request) => projectCashPoolOutstandingCents(request))
      ]
    );
    const cashAvailableCents = actualReceiptsCents - actualPaidCents - occupiedCents;
    const cashAvailableForCurrent = Math.max(cashAvailableCents, 0);

    if (requestedAmountCents <= cashAvailableForCurrent) {
      return [];
    }

    const quotaIds = financingQuotas.map((quota) => quota.id);
    const [paymentFinancingUsages, expenseFinancingUsages] = quotaIds.length
      ? await Promise.all([
          tx.projectFinancingQuotaUsage.findMany({
            where: {
              quotaId: { in: quotaIds },
              status: { in: [...PROJECT_FINANCING_USAGE_ACTIVE_STATUSES] }
            },
            select: { quotaId: true, amountCents: true }
          }),
          projectExpenseFinancingUsageClient
            ? projectExpenseFinancingUsageClient.findMany({
                where: {
                  quotaId: { in: quotaIds },
                  status: { in: [...PROJECT_FINANCING_USAGE_ACTIVE_STATUSES] }
                },
                select: { quotaId: true, amountCents: true }
              })
            : Promise.resolve([])
        ])
      : [[], []];
    const usedByQuotaId = [...paymentFinancingUsages, ...expenseFinancingUsages].reduce((used, usage) => {
      used.set(usage.quotaId, (used.get(usage.quotaId) ?? 0n) + BigInt(usage.amountCents));
      return used;
    }, new Map<string, bigint>());

    let remaining = BigInt(requestedAmountCents - cashAvailableForCurrent);
    const allocations: Array<{ quotaId: string; amountCents: bigint }> = [];
    let totalAvailableFinancingCents = 0n;
    for (const quota of financingQuotas) {
      const available = BigInt(quota.amountCents) - (usedByQuotaId.get(quota.id) ?? 0n);
      if (available <= 0n) {
        continue;
      }
      totalAvailableFinancingCents += available;
      const amount = available >= remaining ? remaining : available;
      allocations.push({ quotaId: quota.id, amountCents: amount });
      remaining -= amount;
      if (remaining === 0n) {
        break;
      }
    }

    if (remaining > 0n) {
      const availableCents = BigInt(cashAvailableForCurrent) + totalAvailableFinancingCents;
      throw new BadRequestException(`项目现金资金池余额不足: ${availableCents.toString()}`);
    }

    return allocations;
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

  private async useFinancingQuotaUsage(
    tx: Prisma.TransactionClient,
    payment: PaymentExecutionLockRow,
    actorUserId: string
  ) {
    const usageTotals = await this.financingUsageTotals(tx, payment.id);
    const approvedAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
    const activeFinancingCents = usageTotals.occupied + usageTotals.used;
    const cashAllocatedCents = BigInt(approvedAmountCents) - activeFinancingCents;
    const targetUsedCents =
      BigInt(payment.paidAmountCents) > cashAllocatedCents
        ? BigInt(payment.paidAmountCents) - cashAllocatedCents
        : 0n;
    const amountToUse = targetUsedCents > usageTotals.used ? targetUsedCents - usageTotals.used : 0n;
    const usedAmountCents = await this.moveFinancingQuotaUsage(
      tx,
      payment.id,
      amountToUse,
      "used"
    );

    if (usedAmountCents > 0n) {
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.financing_quota.use",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: { usedAmountCents: usedAmountCents.toString() }
      });
    }
  }

  private async releaseInvalidFinancingQuotaBeforeExecution(
    tx: Prisma.TransactionClient,
    payment: PaymentExecutionLockRow,
    actorUserId: string
  ) {
    const occupiedUsages = await tx.projectFinancingQuotaUsage.findMany({
      where: { paymentRequestId: payment.id, status: "occupied" },
      select: {
        quotaId: true,
        projectId: true
      }
    });
    if (!occupiedUsages.length) {
      return false;
    }

    const lockedProjects = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
      SELECT "id", "isActive"
      FROM "Project"
      WHERE "id" = ${payment.projectId}
      FOR UPDATE
    `);
    const quotaIds = [...new Set(occupiedUsages.map((usage) => usage.quotaId))];
    const quotas = await tx.projectFinancingQuota.findMany({
      where: { id: { in: quotaIds } },
      select: { id: true, status: true, validUntil: true }
    });
    const quotaById = new Map(quotas.map((quota) => [quota.id, quota]));
    const now = new Date();
    const hasInvalidQuota =
      !lockedProjects[0]?.isActive ||
      occupiedUsages.some((usage) => {
        const quota = quotaById.get(usage.quotaId);
        return !quota || quota.status !== "approved" || quota.validUntil < now;
      });

    if (!hasInvalidQuota) {
      return false;
    }

    await this.releaseFinancingQuotaUsage(
      tx,
      payment.id,
      actorUserId,
      "payment.financing_quota.release.invalid_before_execution"
    );
    return true;
  }

  private async shrinkFinancingQuotaUsageToApprovedAmount(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      requestedAmountCents: number;
      approvedAmountCents: number | null;
    },
    approvedAmountCents: number,
    actorUserId: string
  ) {
    const usageTotals = await this.financingUsageTotals(tx, payment.id);
    const cashAllocatedCents = BigInt(payment.requestedAmountCents) - usageTotals.occupied - usageTotals.used;
    const targetFinancingCents =
      BigInt(approvedAmountCents) > cashAllocatedCents
        ? BigInt(approvedAmountCents) - cashAllocatedCents
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
        occupied: totals.occupied + (usage.status === "occupied" ? BigInt(usage.amountCents) : 0n),
        used: totals.used + (usage.status === "used" ? BigInt(usage.amountCents) : 0n)
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

      const available = BigInt(usage.amountCents);
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
  ): Promise<number> {
    const projectProxyPaymentClient = (tx as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: { settlementId: string; voidedAt: null };
          select: { amountCents: true };
        }) => Promise<Array<{ amountCents: bigint | number }>>;
      };
    }).projectProxyPayment;

    if (!projectProxyPaymentClient) {
      return 0;
    }

    const payments = await projectProxyPaymentClient.findMany({
      where: { settlementId, voidedAt: null },
      select: { amountCents: true }
    });

    return sumSafeCents(payments.map((payment) => payment.amountCents));
  }

  private async sumProjectProxyPaymentCentsForContract(
    tx: Prisma.TransactionClient,
    contractId: string,
    settlementIds: string[]
  ): Promise<number> {
    const projectProxyPaymentClient = (tx as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: {
            voidedAt: null;
            OR: Array<{ contractId: string } | { settlementId: { in: string[] } }>;
          };
          select: { amountCents: true };
        }) => Promise<Array<{ amountCents: bigint | number }>>;
      };
    }).projectProxyPayment;

    if (!projectProxyPaymentClient) {
      return 0;
    }

    const payments = await projectProxyPaymentClient.findMany({
      where: {
        voidedAt: null,
        OR: [{ contractId }, { settlementId: { in: settlementIds } }]
      },
      select: { amountCents: true }
    });

    return sumSafeCents(payments.map((payment) => payment.amountCents));
  }

  private async sumContractDueAllocatedCentsForSettlement(
    tx: Prisma.TransactionClient,
    settlementId: string
  ): Promise<number> {
    const allocationClient = (tx as unknown as {
      paymentExecutionAllocation?: {
        findMany: (args: {
          where: {
            settlementId: string;
            allocationType: { in: string[] };
          };
          select: { amountCents: true };
        }) => Promise<Array<{ amountCents: number | bigint }>>;
      };
    }).paymentExecutionAllocation;

    if (!allocationClient) {
      return 0;
    }

    const allocations = await allocationClient.findMany({
      where: {
        settlementId,
        allocationType: { in: ["contract_due_payment", "advance_deduction"] }
      },
      select: { amountCents: true }
    });

    return sumSafeCents(allocations.map((allocation) => allocation.amountCents));
  }

  private paymentRequestOutstandingCents(payment: {
    status: string;
    requestedAmountCents: number;
    approvedAmountCents: number | null;
    paidAmountCents: number;
  }): number {
    const payableAmountCents =
      ["approved_pending_payment", "partially_paid", "paid"].includes(payment.status)
        ? (payment.approvedAmountCents ?? payment.requestedAmountCents)
        : payment.requestedAmountCents;

    return Math.max(payableAmountCents - payment.paidAmountCents, 0);
  }

  private async lockPaymentRequestForUpdate(
    tx: Prisma.TransactionClient,
    paymentId: string
  ): Promise<PaymentExecutionLockRow | null> {
    const rows = await tx.$queryRaw<Array<PaymentExecutionLockRow>>(Prisma.sql`
      SELECT
        "id",
        "code",
        "projectId",
        "contractId",
        "settlementId",
        "sourceType",
        "status",
        "requestedAmountCents",
        "approvedAmountCents",
        "paidAmountCents"
      FROM "PaymentRequest"
      WHERE "id" = ${paymentId} OR "code" = ${paymentId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
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
      throw new Error("Prisma service is required to withdraw payment approval");
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

  // 超时催办：申请人督促当前冻结节点（董事长/总经理）处理；超时/重复节流由 shared-domain 判定。
  async remindApproval(paymentId: string, actorUserId: string, now: Date = new Date()) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to remind payment approval");
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
      throw new Error("Prisma service is required to review payment approval");
    }
    if (
      !["approve", "reject", "reject_previous", "return_to_applicant"].includes(
        input.decision
      )
    ) {
      throw new Error("不支持的付款审批处理方式");
    }
    requireApprovalCommentForReturn(input.decision, input.comment);

    let completedInstanceId: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      if (payment.status !== "approval_pending") {
        throw new Error("当前付款申请已离开审批中，不能处理审批");
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

      const nodes = instance.frozenNodes as unknown as PaymentApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前付款审批节点异常，请刷新后重试");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      let approvedRoleKey =
        currentNode.roleKeys.find((role) => actorRoleKeys.includes(role)) ??
        currentNode.assignments?.find((assignment) => assignment.toUserId === actorUserId)
          ?.fromRoleKey;

      if (!approvedRoleKey) {
        approvedRoleKey = await this.resolveDelegatedRoleKey(
          tx,
          actorUserId,
          payment.projectId,
          currentNode.roleKeys
        );
      }

      if (!approvedRoleKey) {
        throw new Error(`当前账号不能处理“${currentNode.name}”付款审批节点`);
      }

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
            comment: input.comment?.trim() || undefined
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
            approvedRoleKey
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
            comment: input.comment?.trim() || undefined
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
            approvedRoleKey
          }
        });

        return updated;
      }

      if (input.decision === "reject") {
        const rejected = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: {
            status: "rejected",
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
            comment: input.comment?.trim() || undefined
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
            toStatus: "rejected",
            nodeName: currentNode.name,
            approvedRoleKey
          }
        });
        return rejected;
      }

      if (
        input.approvedAmountCents !== undefined &&
        (!Number.isFinite(input.approvedAmountCents) ||
          !Number.isInteger(input.approvedAmountCents) ||
          input.approvedAmountCents <= 0)
      ) {
        throw new Error("批准付款金额必须大于 0，请按元填写有效金额");
      }

      if (
        input.approvedAmountCents !== undefined &&
        input.approvedAmountCents > payment.requestedAmountCents
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
      const approvedAmountCents = input.approvedAmountCents ?? payment.requestedAmountCents;

      if (!flowCompleted && input.approvedAmountCents !== undefined) {
        throw new Error("只有最后一个付款审批节点才能调整批准金额");
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
          comment: input.comment?.trim() || undefined
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
          requestedAmountCents: payment.requestedAmountCents,
          approvedAmountCents: flowCompleted ? approvedAmountCents : undefined,
          nodeName: currentNode.name,
          approvedRoleKey,
          nodeCompleted
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

  transferApproval(paymentId: string, actorUserId: string, input: AssignApprovalDto) {
    return this.assignApproval("transfer", paymentId, actorUserId, input);
  }

  delegateApproval(paymentId: string, actorUserId: string, input: AssignApprovalDto) {
    return this.assignApproval("delegate", paymentId, actorUserId, input);
  }

  private async createContractDuePaymentExecutionAllocations(
    tx: Prisma.TransactionClient,
    payment: PaymentExecutionLockRow,
    paymentExecutionId: string,
    amountCents: number,
    paidAt: Date,
    actorUserId: string
  ): Promise<void> {
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
      throw new Error("Contract due payment execution has no effective settlements to allocate");
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
        requestedAmountCents: number;
        approvedAmountCents: number | null;
        paidAmountCents: number;
      }>>;
    };
    const projectProxyPaymentClient = (tx as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: Record<string, unknown>;
          select: Record<string, boolean>;
        }) => Promise<Array<{ settlementId: string | null; amountCents: bigint | number }>>;
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
      tx.settlementArchiveFile.findMany({
        where: {
          settlementId: { in: settlementIds },
          status: "confirmed",
          confirmedAt: { not: null }
        },
        select: { settlementId: true, confirmedAt: true }
      }),
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
      syntheticAmountCents: number,
      sections = preview.sections
    ) => {
      if (syntheticAmountCents <= 0) return;
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
      if ((settlement.paidAmountCents ?? 0) <= 0) continue;
      registerSyntheticConsumption(
        settlement.paidAmountCents ?? 0,
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
      const syntheticAmountCents = sumSafeCents([proxyPayment.amountCents]);
      registerSyntheticConsumption(
        syntheticAmountCents,
        proxyPayment.settlementId
          ? this.contractDueSectionsForSettlement(preview.sections, proxyPayment.settlementId)
          : preview.sections
      );
    }

    const allocatedCentsByPaymentRequestId = existingAllocations
      .filter((allocation) => allocation.allocationType === "contract_due_payment")
      .reduce<Map<string, number>>(
        (totals, allocation) => {
          totals.set(
            allocation.paymentRequestId,
            (totals.get(allocation.paymentRequestId) ?? 0) + allocation.amountCents
          );
          return totals;
        },
        new Map()
      );
    for (const paidRequest of contractDuePaidRequests) {
      if (!paidRequest.id) continue;
      const residualPaidCents =
        paidRequest.paidAmountCents - (allocatedCentsByPaymentRequestId.get(paidRequest.id) ?? 0);
      registerSyntheticConsumption(residualPaidCents);
    }
    const existingAdvanceDeductionCents = sumSafeCents(
      existingAllocations
        .filter((allocation) => allocation.allocationType === "advance_deduction")
        .map((allocation) => allocation.amountCents)
    );
    const residualAdvanceDeductionCents = Math.max(
      preview.advanceDeduction.currentDeductionCents - existingAdvanceDeductionCents,
      0
    );
    const advanceDeductionAllocations =
      residualAdvanceDeductionCents > 0
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
      throw new Error("Prisma service is required to record payment execution");
    }

    if (typeof input.amountCents !== "number" || input.amountCents <= 0) {
      throw new Error("实付金额必须大于 0");
    }

    if (!input.voucherFileId?.trim()) {
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
      throw new Error("Auth service is required to confirm payment execution");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    let blockedReason: string | undefined;
    const execution = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentRequestForUpdate(tx, paymentId);

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      if (!["approved_pending_payment", "partially_paid"].includes(payment.status)) {
        throw new Error(this.paymentExecutionBlockedMessage(payment.status));
      }

      if (payment.sourceType === "contract_due" && !payment.settlementId) {
        await this.lockContractPaymentCapacityRows(tx, payment.contractId);
      } else if (payment.sourceType === "contract_advance") {
        await this.lockContractAdvancePaymentRows(tx, payment.contractId);
      }

      const approvedAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      const remainingAmountCents = approvedAmountCents - payment.paidAmountCents;
      if (input.amountCents > remainingAmountCents) {
        throw new Error(
          `实付金额超过付款申请剩余可实付金额，当前最多可实付 ${this.formatYuan(
            Math.max(remainingAmountCents, 0)
          )} 元`
        );
      }
      if (this.files) {
        await this.files.assertCanDownloadFile(tx, input.voucherFileId, actorUserId);
      }

      const newPaymentPaidAmountCents = payment.paidAmountCents + input.amountCents;
      const newPaymentStatus =
        newPaymentPaidAmountCents >= approvedAmountCents ? "paid" : "partially_paid";
      let settlement:
        | { id: string; payableAmountCents: number; paidAmountCents: number }
        | null = null;
      let newSettlementPaidAmountCents: number | null = null;
      let newSettlementStatus: "paid" | "partially_paid" | null = null;

      if (payment.settlementId) {
        await this.lockSettlementForPaymentExecution(tx, payment.settlementId);
        settlement = await tx.settlement.findUnique({
          where: { id: payment.settlementId }
        });

        if (!settlement) {
          throw new Error("未找到关联结算，请先核对结算归档记录");
        }

        const proxyPaidCents = await this.sumProjectProxyPaymentCents(tx, settlement.id);
        const contractDueAllocatedCents = await this.sumContractDueAllocatedCentsForSettlement(
          tx,
          settlement.id
        );
        const settlementExecutionRemainingCents =
          settlement.payableAmountCents -
          settlement.paidAmountCents -
          proxyPaidCents -
          contractDueAllocatedCents;
        if (input.amountCents > settlementExecutionRemainingCents) {
          throw new Error(
            `实付金额超过结算剩余可付金额，当前最多可实付 ${this.formatYuan(
              Math.max(settlementExecutionRemainingCents, 0)
            )} 元`
          );
        }

        newSettlementPaidAmountCents = settlement.paidAmountCents + input.amountCents;
        newSettlementStatus =
          newSettlementPaidAmountCents >= settlement.payableAmountCents
            ? "paid"
            : "partially_paid";
      }

      const invalidFinancingQuota = await this.releaseInvalidFinancingQuotaBeforeExecution(
        tx,
        payment,
        actorUserId
      );
      if (invalidFinancingQuota) {
        blockedReason = "项目垫资额度已失效，请重新提交付款申请";
        return null;
      }

      const execution = await tx.paymentExecution.create({
        data: {
          paymentRequestId: payment.id,
          settlementId: payment.settlementId,
          amountCents: input.amountCents,
          paidAt,
          executedByUserId: actorUserId,
          voucherFileId: input.voucherFileId
        }
      });

      if (payment.sourceType === "contract_due" && !payment.settlementId) {
        await this.createContractDuePaymentExecutionAllocations(
          tx,
          payment,
          execution.id,
          input.amountCents,
          paidAt,
          actorUserId
        );
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

      await this.useFinancingQuotaUsage(
        tx,
        {
          ...payment,
          paidAmountCents: newPaymentPaidAmountCents
        },
        actorUserId
      );

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.execution.record",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code,
          executionId: execution.id,
          amountCents: input.amountCents,
          voucherFileId: input.voucherFileId,
          fromStatus: payment.status,
          toStatus: newPaymentStatus
        }
      });

      return execution;
    });

    if (blockedReason || !execution) {
      throw new BadRequestException(blockedReason ?? "付款实付登记被阻断");
    }

    return execution;
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
      throw new Error("Prisma service is required to record finance entry");
    }

    if (typeof input.amountCents !== "number" || input.amountCents <= 0) {
      throw new Error("财务入账金额必须大于 0");
    }

    if (!input.confirmationPassword?.trim()) {
      throw new Error("财务入账需要当前登录密码确认");
    }

    if (!this.auth) {
      throw new Error("Auth service is required to confirm finance record");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentRequestForUpdate(tx, paymentId);

      if (!payment) {
        throw new Error("未找到付款申请，请刷新付款台账后重试");
      }

      if (payment.paidAmountCents <= 0) {
        throw new Error("付款尚未登记实付，不能做财务入账");
      }

      const existingRecords = await tx.financeRecord.findMany({
        where: { paymentRequestId: payment.id }
      });
      const recordedAmountCents = existingRecords.reduce(
        (total, record) => total + record.amountCents,
        0
      );
      const unrecordedPaidAmountCents = payment.paidAmountCents - recordedAmountCents;
      if (input.amountCents > unrecordedPaidAmountCents) {
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
          amountCents: input.amountCents,
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
          amountCents: input.amountCents,
          direction: "outflow"
        }
      });
      return financeRecord;
    });
  }

  async recordPdfArchive(
    paymentId: string,
    actorUserId: string,
    input: RecordPaymentPdfArchiveDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to record payment PDF archive");
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
      const financeRecordedAmountCents = financeRecords.reduce(
        (total, record) => total + record.amountCents,
        0
      );

      if (payment.paidAmountCents <= 0 || financeRecordedAmountCents < payment.paidAmountCents) {
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
      throw new Error("Prisma service is required to generate payment PDF archive");
    }

    if (!this.files) {
      throw new Error("File service is required to generate payment PDF archive");
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
      const financeRecordedAmountCents = financeRecords.reduce(
        (total, record) => total + record.amountCents,
        0
      );

      if (payment.paidAmountCents <= 0 || financeRecordedAmountCents < payment.paidAmountCents) {
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

  // 常驻委托台账消费：本人岗位/节点指派都不命中时，看是否有在窗口内的委托人持有该节点角色。
  private async resolveDelegatedRoleKey(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string,
    nodeRoleKeys: RoleKey[]
  ): Promise<RoleKey | undefined> {
    if (!this.delegations) {
      return undefined;
    }

    const delegatorIds = await this.delegations.activeDelegatorIds(tx, actorUserId);

    for (const delegatorId of delegatorIds) {
      const delegatorRoleKeys = await this.loadActorRoleKeys(tx, delegatorId, projectId);
      const match = nodeRoleKeys.find((role) => delegatorRoleKeys.includes(role));

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private formatCents(value: number) {
    return `${(value / 100).toFixed(2)} CNY`;
  }

  private formatYuan(value: number) {
    return this.formatCents(value).replace(" CNY", "");
  }

  private async assignApproval(
    kind: PaymentApprovalAssignment["kind"],
    paymentId: string,
    actorUserId: string,
    input: AssignApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to assign payment approval");
    }

    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("Payment approval assignment target is invalid");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.status !== "approval_pending") {
        throw new Error(`Cannot assign payment approval from status ${payment.status}`);
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
        throw new Error("Payment approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as PaymentApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("Payment approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      const fromRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));

      if (!fromRoleKey) {
        throw new Error(`Actor cannot assign payment node ${currentNode.name}`);
      }

      const nextNodes = [...nodes];
      const nextAssignments = [
        ...(currentNode.assignments ?? []).filter(
          (assignment) =>
            !(
              assignment.kind === kind &&
              assignment.fromUserId === actorUserId &&
              assignment.fromRoleKey === fromRoleKey
            )
        ),
        { kind, fromUserId: actorUserId, fromRoleKey, toUserId: input.toUserId }
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
          actorUserId
        }
      });

      if (kind === "delegate") {
        const startsAt = new Date();
        await tx.approvalDelegation.create({
          data: {
            fromUserId: actorUserId,
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

function requireApprovalCommentForReturn(decision: ReviewPaymentApprovalDto["decision"], comment?: string) {
  if (decision !== "approve" && !comment?.trim()) {
    throw new Error("Payment approval comment is required for reject or return decisions");
  }
}

function projectCashPoolOutstandingCents(payment: {
  status: string;
  requestedAmountCents: number;
  approvedAmountCents?: number | null;
  paidAmountCents: number;
}): number {
  if (["approval_pending", "in_approval"].includes(payment.status)) {
    return Math.max(payment.requestedAmountCents - payment.paidAmountCents, 0);
  }

  if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
    return Math.max(
      (payment.approvedAmountCents ?? payment.requestedAmountCents) - payment.paidAmountCents,
      0
    );
  }

  return 0;
}

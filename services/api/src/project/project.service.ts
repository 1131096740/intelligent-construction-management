import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional
} from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import {
  calculateSettlementPaymentCapacity,
  SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
  sumSafeCents
} from "../payment/settlement-payment-capacity";
import type {
  RecordProjectProxyPaymentDto,
  ProjectProxyPaymentType
} from "./dto/record-project-proxy-payment.dto";
import type { RecordProjectReceiptDto, ProjectReceiptSourceType } from "./dto/record-project-receipt.dto";

const DATA_GAPS = [
  "缺少对上结算/业主审定台账，当前经营收入和毛利为实际收款与总包代付发生口径。",
  "缺少项目垫资额度台账，当前可用资金未包含批准垫资额度。"
];
const FUNDS_OVERVIEW_POSITIONS = new Set<RoleKey>([
  "chairman",
  "general_manager",
  "project_manager",
  "finance_director",
  "finance_staff"
]);
const RECEIPT_SOURCE_LABELS: Record<ProjectReceiptSourceType, string> = {
  general_contractor_payment: "总包付款",
  owner_direct_payment: "甲方直付",
  other: "其他"
};
const PROXY_PAYMENT_TYPE_LABELS: Record<ProjectProxyPaymentType, string> = {
  material: "材料",
  equipment: "机械",
  labor: "劳务",
  professional_subcontract: "专业分包",
  other: "其他"
};
const EFFECTIVE_SETTLEMENT_STATUSES = new Set(["effective", "partially_paid", "paid"]);

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService
  ) {}

  async listActiveOptions(userId: string) {
    const [globalUserPositions, projectUserPositions, projectMemberPositions] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
      this.prisma.projectMember.findMany({ where: { userId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalUserPositions, ...projectUserPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const hasGlobalFundsOverview = globalUserPositions.some((position) =>
      isFundsOverviewPosition(positionKeyById.get(position.positionId))
    );

    if (hasGlobalFundsOverview) {
      return this.findActiveProjectOptions();
    }

    const visibleProjectIds = unique([
      ...projectUserPositions
        .filter((position) => isFundsOverviewPosition(positionKeyById.get(position.positionId)))
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMemberPositions
        .filter((position) => isFundsOverviewPosition(position.positionKey as RoleKey))
        .map((position) => position.projectId)
    ]);

    if (!visibleProjectIds.length) {
      return [];
    }

    return this.findActiveProjectOptions({ id: { in: visibleProjectIds } });
  }

  private findActiveProjectOptions(extraWhere: object = {}) {
    return this.prisma.project.findMany({
      where: { isActive: true, ...extraWhere },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
  }

  async getOperatingFundsOverview(projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true, code: true, name: true }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const [
      contracts,
      settlements,
      payments,
      financeRecords,
      projectReceipts,
      projectProxyPayments
    ] = await Promise.all([
      this.prisma.contract.findMany({
        where: { projectId, voidedAt: null },
        select: { id: true }
      }),
      this.prisma.settlement.findMany({
        where: { projectId },
        select: { status: true, amountCents: true, payableAmountCents: true }
      }),
      this.prisma.paymentRequest.findMany({
        where: { projectId },
        select: {
          id: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      this.prisma.financeRecord.findMany({
        where: { projectId, direction: "outflow" },
        select: { amountCents: true }
      }),
      this.prisma.projectReceipt.findMany({
        where: { projectId, voidedAt: null },
        select: { amountCents: true }
      }),
      this.prisma.projectProxyPayment.findMany({
        where: { projectId, voidedAt: null },
        select: { amountCents: true }
      })
    ]);
    const contractIds = contracts.map((contract) => contract.id);
    const paymentIds = payments.map((payment) => payment.id);
    const contractVersions = contractIds.length
      ? await this.prisma.contractVersion.findMany({
          where: { contractId: { in: contractIds }, status: "effective" },
          select: { contractId: true, versionNo: true, amountCents: true }
        })
      : [];
    const latestEffectiveContractVersions = latestByContract(contractVersions);
    const effectiveSettlements = settlements.filter((settlement) => settlement.status === "effective");
    const executions = paymentIds.length
      ? await this.prisma.paymentExecution.findMany({
          where: { paymentRequestId: { in: paymentIds } },
          select: { amountCents: true }
        })
      : [];
    const actualReceiptsCents = sumCents(projectReceipts.map((receipt) => receipt.amountCents));
    const proxyPaymentCents = sumCents(projectProxyPayments.map((payment) => payment.amountCents));
    const actualPaidCents = sumNumbers(executions.map((execution) => execution.amountCents));
    const approvalPendingOccupancyCents = sumNumbers(
      payments
        .filter((payment) => payment.status === "approval_pending")
        .map((payment) => payment.requestedAmountCents)
    );
    const approvedPendingPaymentCents = sumNumbers(
      payments
        .filter((payment) => ["approved_pending_payment", "partially_paid"].includes(payment.status))
        .map((payment) =>
          Math.max((payment.approvedAmountCents ?? payment.requestedAmountCents) - payment.paidAmountCents, 0)
        )
    );
    const availableFundsCents =
      actualReceiptsCents -
      actualPaidCents -
      approvalPendingOccupancyCents -
      approvedPendingPaymentCents;

    return {
      project,
      cash: {
        actualReceiptsCents,
        availableFundsCents,
        actualPaidCents,
        approvalPendingOccupancyCents,
        approvedPendingPaymentCents,
        financeRecordedOutflowCents: sumNumbers(financeRecords.map((record) => record.amountCents))
      },
      business: {
        effectiveContractAmountCents: sumCents(latestEffectiveContractVersions.map((version) => version.amountCents)),
        effectiveSettlementAmountCents: sumNumbers(effectiveSettlements.map((settlement) => settlement.amountCents)),
        payableSettlementAmountCents: sumNumbers(effectiveSettlements.map((settlement) => settlement.payableAmountCents)),
        operatingIncomeCents: actualReceiptsCents + proxyPaymentCents,
        operatingCostCents: actualPaidCents + proxyPaymentCents,
        grossProfitCents: actualReceiptsCents - actualPaidCents
      },
      counts: {
        contracts: contracts.length,
        settlements: settlements.length,
        payments: payments.length
      },
      dataGaps: DATA_GAPS
    };
  }

  async recordReceipt(projectId: string, actorUserId: string, input: RecordProjectReceiptDto) {
    const amountCents = normalizePositiveSafeInteger(input.amountCents, "Receipt amount must be greater than zero");
    const receivedAt = parseReceiptDate(input.receivedAt);
    const payerName = requiredTrimmed(input.payerName, "Receipt payer is required");
    const sourceType = normalizeSourceType(input.sourceType);
    const voucherFileId = requiredTrimmed(input.voucherFileId, "Receipt voucher file is required");
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "Receipt confirmation password is required"
    );
    const description =
      typeof input.description === "string" ? input.description.trim() || undefined : undefined;

    if (!this.auth) {
      throw new Error("Auth service is required to confirm project receipt");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, isActive: true },
        select: { id: true }
      });

      if (!project) {
        throw new NotFoundException("Project not found");
      }

      const voucher = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: { id: true, uploadedByUserId: true }
      });

      if (!voucher) {
        throw new NotFoundException("Receipt voucher file not found");
      }

      if (voucher.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("Receipt voucher file must be uploaded by the recorder");
      }

      const receipt = await tx.projectReceipt.create({
        data: {
          projectId: project.id,
          receivedAt,
          amountCents: BigInt(amountCents),
          payerName,
          sourceType,
          description,
          voucherFileId,
          recordedByUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project.receipt.record",
        businessType: "project_receipt",
        businessId: receipt.id,
        metadata: {
          projectId: project.id,
          receiptId: receipt.id,
          amountCents,
          sourceType,
          payerName,
          voucherFileId
        }
      });

      return toReceiptReadModel(receipt);
    });
  }

  async recordProxyPayment(projectId: string, actorUserId: string, input: RecordProjectProxyPaymentDto) {
    const amountCents = normalizePositiveSafeInteger(
      input.amountCents,
      "Project proxy payment amount must be greater than zero"
    );
    const paidAt = parseProxyPaymentDate(input.paidAt);
    const generalContractorName = requiredTrimmed(
      input.generalContractorName,
      "General contractor is required"
    );
    const paidTargetName = requiredTrimmed(input.paidTargetName, "Proxy payment target is required");
    const paymentType = normalizeProxyPaymentType(input.paymentType);
    const voucherFileId = requiredTrimmed(input.voucherFileId, "Project proxy payment voucher file is required");
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "Project proxy payment confirmation password is required"
    );
    const description =
      typeof input.description === "string" ? input.description.trim() || undefined : undefined;
    const requestedContractId = optionalTrimmed(input.contractId);
    const requestedSettlementId = optionalTrimmed(input.settlementId);

    if (!this.auth) {
      throw new Error("Auth service is required to confirm project proxy payment");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, isActive: true },
        select: { id: true }
      });

      if (!project) {
        throw new NotFoundException("Project not found");
      }

      const voucher = await tx.fileObject.findUnique({
        where: { id: voucherFileId },
        select: { id: true, uploadedByUserId: true }
      });

      if (!voucher) {
        throw new NotFoundException("Project proxy payment voucher file not found");
      }

      if (voucher.uploadedByUserId !== actorUserId) {
        throw new BadRequestException("Project proxy payment voucher file must be uploaded by the recorder");
      }

      let linkedContractId = requestedContractId ?? null;
      let linkedSettlementId = requestedSettlementId ?? null;

      if (requestedContractId) {
        const contract = await tx.contract.findFirst({
          where: {
            projectId: project.id,
            voidedAt: null,
            OR: [
              { id: requestedContractId },
              { code: requestedContractId },
              { temporaryCode: requestedContractId }
            ]
          },
          select: { id: true }
        });

        if (!contract) {
          throw new NotFoundException("Linked contract not found in project");
        }

        linkedContractId = contract.id;
      }

      if (requestedSettlementId) {
        const settlement = await tx.settlement.findFirst({
          where: {
            projectId: project.id,
            OR: [{ id: requestedSettlementId }, { code: requestedSettlementId }]
          },
          select: {
            id: true,
            contractId: true,
            status: true,
            payableAmountCents: true,
            paidAmountCents: true
          }
        });

        if (!settlement) {
          throw new NotFoundException("Linked settlement not found in project");
        }

        if (!EFFECTIVE_SETTLEMENT_STATUSES.has(settlement.status)) {
          throw new BadRequestException("Linked settlement is not effective");
        }

        if (linkedContractId && settlement.contractId !== linkedContractId) {
          throw new BadRequestException("Linked settlement does not belong to linked contract");
        }

        const [existingProxyPayments, paymentRequests] = await Promise.all([
          tx.projectProxyPayment.findMany({
            where: { settlementId: settlement.id, voidedAt: null },
            select: { amountCents: true }
          }),
          tx.paymentRequest.findMany({
            where: {
              settlementId: settlement.id,
              status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES] }
            },
            select: {
              status: true,
              requestedAmountCents: true,
              approvedAmountCents: true,
              paidAmountCents: true
            }
          })
        ]);
        const proxyPaidCents = sumSafeCents(existingProxyPayments.map((payment) => payment.amountCents));
        const capacity = calculateSettlementPaymentCapacity({
          payableAmountCents: settlement.payableAmountCents,
          actualPaidAmountCents: settlement.paidAmountCents,
          proxyPaidAmountCents: proxyPaidCents,
          paymentRequests
        });

        if (amountCents > capacity.remainingCents) {
          throw new BadRequestException(
            `Project proxy payment exceeds settlement remaining payable amount: ${Math.max(
              capacity.remainingCents,
              0
            )}`
          );
        }

        linkedSettlementId = settlement.id;
        linkedContractId = settlement.contractId;
      }

      const proxyPayment = await tx.projectProxyPayment.create({
        data: {
          projectId: project.id,
          paidAt,
          amountCents: BigInt(amountCents),
          generalContractorName,
          paidTargetName,
          paymentType,
          description,
          voucherFileId,
          recordedByUserId: actorUserId,
          contractId: linkedContractId,
          settlementId: linkedSettlementId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "project.proxy_payment.record",
        businessType: "project_proxy_payment",
        businessId: proxyPayment.id,
        metadata: {
          projectId: project.id,
          proxyPaymentId: proxyPayment.id,
          amountCents,
          paymentType,
          generalContractorName,
          paidTargetName,
          voucherFileId,
          contractId: linkedContractId,
          settlementId: linkedSettlementId
        }
      });

      return toProxyPaymentReadModel(proxyPayment);
    });
  }
}

function isFundsOverviewPosition(positionKey: RoleKey | undefined): boolean {
  return !!positionKey && FUNDS_OVERVIEW_POSITIONS.has(positionKey);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function latestByContract<T extends { contractId: string; versionNo?: number | null }>(versions: T[]): T[] {
  return Array.from(
    versions.reduce((latestById, version) => {
      const current = latestById.get(version.contractId);
      if (!current || (version.versionNo ?? 0) > (current.versionNo ?? 0)) {
        latestById.set(version.contractId, version);
      }
      return latestById;
    }, new Map<string, T>()).values()
  );
}

function sumNumbers(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumCents(values: Array<bigint | number>): number {
  const total = values.reduce<bigint>((sum, value) => sum + BigInt(toSafeNumber(value)), BigInt(0));
  return toSafeNumber(total);
}

function toSafeNumber(value: bigint | number): number {
  if (typeof value === "number") {
    return value;
  }
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new InternalServerErrorException("Amount exceeds safe integer range");
  }
  return converted;
}

function normalizePositiveSafeInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(message);
  }
  return value;
}

function parseReceiptDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("Receipt date is invalid");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Receipt date is invalid");
  }
  return parsed;
}

function parseProxyPaymentDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new BadRequestException("Project proxy payment date is invalid");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Project proxy payment date is invalid");
  }
  return parsed;
}

function requiredTrimmed(value: unknown, message: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new BadRequestException(message);
  }
  return trimmed;
}

function optionalTrimmed(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function normalizeSourceType(value: unknown): ProjectReceiptSourceType {
  if (typeof value !== "string") {
    throw new BadRequestException("Receipt source type is invalid");
  }
  if (!Object.prototype.hasOwnProperty.call(RECEIPT_SOURCE_LABELS, value)) {
    throw new BadRequestException("Receipt source type is invalid");
  }
  return value as ProjectReceiptSourceType;
}

function normalizeProxyPaymentType(value: unknown): ProjectProxyPaymentType {
  if (typeof value !== "string") {
    throw new BadRequestException("Project proxy payment type is invalid");
  }
  if (!Object.prototype.hasOwnProperty.call(PROXY_PAYMENT_TYPE_LABELS, value)) {
    throw new BadRequestException("Project proxy payment type is invalid");
  }
  return value as ProjectProxyPaymentType;
}

function toReceiptReadModel(receipt: {
  id: string;
  projectId: string;
  receivedAt: Date;
  amountCents: bigint | number;
  payerName: string;
  sourceType: string;
  description?: string | null;
  voucherFileId: string;
  recordedByUserId: string;
  createdAt: Date;
}) {
  const sourceType = normalizeSourceType(receipt.sourceType as ProjectReceiptSourceType);
  return {
    id: receipt.id,
    projectId: receipt.projectId,
    receivedAt: receipt.receivedAt.toISOString(),
    amountCents: toSafeNumber(receipt.amountCents),
    payerName: receipt.payerName,
    sourceType,
    sourceTypeLabel: RECEIPT_SOURCE_LABELS[sourceType],
    description: receipt.description ?? null,
    voucherFileId: receipt.voucherFileId,
    recordedByUserId: receipt.recordedByUserId,
    createdAt: receipt.createdAt.toISOString()
  };
}

function toProxyPaymentReadModel(proxyPayment: {
  id: string;
  projectId: string;
  paidAt: Date;
  amountCents: bigint | number;
  generalContractorName: string;
  paidTargetName: string;
  paymentType: string;
  description?: string | null;
  voucherFileId: string;
  recordedByUserId: string;
  contractId?: string | null;
  settlementId?: string | null;
  createdAt: Date;
}) {
  const paymentType = normalizeProxyPaymentType(proxyPayment.paymentType as ProjectProxyPaymentType);
  return {
    id: proxyPayment.id,
    projectId: proxyPayment.projectId,
    paidAt: proxyPayment.paidAt.toISOString(),
    amountCents: toSafeNumber(proxyPayment.amountCents),
    generalContractorName: proxyPayment.generalContractorName,
    paidTargetName: proxyPayment.paidTargetName,
    paymentType,
    paymentTypeLabel: PROXY_PAYMENT_TYPE_LABELS[paymentType],
    description: proxyPayment.description ?? null,
    voucherFileId: proxyPayment.voucherFileId,
    recordedByUserId: proxyPayment.recordedByUserId,
    contractId: proxyPayment.contractId ?? null,
    settlementId: proxyPayment.settlementId ?? null,
    createdAt: proxyPayment.createdAt.toISOString()
  };
}

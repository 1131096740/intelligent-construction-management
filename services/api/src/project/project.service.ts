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
import type { RecordProjectReceiptDto, ProjectReceiptSourceType } from "./dto/record-project-receipt.dto";

const DATA_GAPS = [
  "缺少总包代付台账，暂不能识别已由总包直接支付的支出。",
  "缺少对上结算/业主审定台账，暂不能计算经营收入和毛利。",
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

    const [contracts, settlements, payments, financeRecords, projectReceipts] = await Promise.all([
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
        operatingIncomeCents: null,
        operatingCostCents: null,
        grossProfitCents: null
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

function requiredTrimmed(value: unknown, message: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new BadRequestException(message);
  }
  return trimmed;
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

import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

const DATA_GAPS = [
  "缺少项目实际收款台账，暂不能计算实际收款和可用资金。",
  "缺少总包代付台账，暂不能识别已由总包直接支付的支出。",
  "缺少对上结算/业主审定台账，暂不能计算经营收入和毛利。",
  "缺少项目垫资额度与资金预占台账，暂不能计算真实可用资金。"
];
const FUNDS_OVERVIEW_POSITIONS = new Set<RoleKey>([
  "chairman",
  "general_manager",
  "project_manager",
  "finance_director",
  "finance_staff"
]);

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

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

    const [contracts, settlements, payments, financeRecords] = await Promise.all([
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
          approvedAmountCents: true
        }
      }),
      this.prisma.financeRecord.findMany({
        where: { projectId, direction: "outflow" },
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

    return {
      project,
      cash: {
        actualReceiptsCents: null,
        availableFundsCents: null,
        actualPaidCents: sumNumbers(executions.map((execution) => execution.amountCents)),
        approvalPendingOccupancyCents: sumNumbers(
          payments
            .filter((payment) => payment.status === "approval_pending")
            .map((payment) => payment.requestedAmountCents)
        ),
        approvedPendingPaymentCents: sumNumbers(
          payments
            .filter((payment) => payment.status === "approved_pending_payment")
            .map((payment) => payment.approvedAmountCents ?? payment.requestedAmountCents)
        ),
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

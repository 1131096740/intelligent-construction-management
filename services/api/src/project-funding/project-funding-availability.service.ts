import {
  BadRequestException,
  ConflictException,
  Injectable
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  dbMoneyToBigInt,
  sumDbMoneyToBigInt
} from "../money/decimal-money";
import {
  assertProjectFinancingQuotaApprovalLifecycle,
  indexProjectFinancingQuotaApprovalInstances
} from "../project/project-financing-quota-approval";

export type ProjectFundingExecutionType =
  | "payment_execution"
  | "fund_movement"
  | "project_expense_execution"
  | "spot_procurement_payment_execution"
  | "expense_claim_payment_execution"
  | "employee_loan_disbursement";

type FundingSourceType = "project_cash" | "financing_quota";

export interface AllocateProjectFundingInput {
  projectId: string;
  executionType: ProjectFundingExecutionType;
  executionId: string;
  businessType: string;
  businessId: string;
  amountCents: bigint;
  occurredAt: Date;
  actorUserId: string;
}

export interface ReverseProjectFundingInput {
  projectId: string;
  executionType: ProjectFundingExecutionType;
  executionId: string;
  amountCents?: bigint;
  occurredAt?: Date;
  reversalKey: string;
  reason: string;
  actorUserId: string;
}

interface FundingAllocationFact {
  sourceType: FundingSourceType;
  sourceId: string | null;
  amountCents: bigint;
}

interface FundingAllocationResult {
  kind: "allocated" | "replayed";
  projectCashAmountCents: bigint;
  financingQuotaAmountCents: bigint;
  allocations: FundingAllocationFact[];
}

export interface FundingAllocationRow {
  id: string;
  projectId: string;
  executionType: string;
  executionId: string;
  businessType: string;
  businessId: string;
  sourceType: string;
  sourceKey: string;
  sourceId: string | null;
  direction: string;
  amountCents: bigint;
  occurredAt: Date;
  createdByUserId: string;
  reversalOfAllocationId: string | null;
  reversalKey: string;
  reason: string | null;
}

export interface ProjectFundingAllocationSummary {
  debitBySource: ReadonlyMap<string, bigint>;
  creditBySource: ReadonlyMap<string, bigint>;
  netUsedBySource: ReadonlyMap<string, bigint>;
}

export interface ProjectFundingLedgerCoverage {
  projectCashSourceAmountCents: bigint;
  allocationSummary: ProjectFundingAllocationSummary;
}

@Injectable()
export class ProjectFundingAvailabilityService {
  async lockFundingContext(
    tx: Prisma.TransactionClient,
    projectId: string
  ): Promise<void> {
    await this.lockActiveProject(tx, projectId);
    await this.lockAvailableQuotas(tx, projectId);
  }

  async assertPersistedProjectFundingLedgerCoverage(
    tx: Prisma.TransactionClient,
    projectId: string
  ): Promise<ProjectFundingLedgerCoverage> {
    const [receipts, affiliateRemittances, quotas, allocations] = await Promise.all([
      tx.projectReceipt.findMany({
        where: {
          projectId,
          voidedAt: null,
          sourceType: { in: ["general_contractor_payment", "other"] }
        },
        select: { amountCents: true }
      }),
      tx.projectUpstreamFundFact.findMany({
        where: {
          projectId,
          factType: "affiliate_remittance_to_company",
          status: "confirmed"
        },
        select: { amountCents: true, effectDirection: true }
      }),
      tx.projectFinancingQuota.findMany({
        where: { projectId },
        select: {
          id: true,
          amountCents: true,
          status: true,
          requestedByUserId: true,
          approvedByUserId: true,
          approvedAt: true
        }
      }),
      tx.projectFundingAllocation.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    ]);
    const quotaIds = quotas.map((quota) => quota.id);
    const approvalInstances = quotaIds.length
      ? await tx.approvalInstance.findMany({
          where: {
            businessType: "project_financing_quota",
            flowType: "project_financing_quota.approve",
            businessId: { in: quotaIds }
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }]
        })
      : [];
    const approvalByQuotaId = indexProjectFinancingQuotaApprovalInstances(
      approvalInstances
    );
    for (const quota of quotas) {
      assertProjectFinancingQuotaApprovalLifecycle(
        quota,
        approvalByQuotaId.get(quota.id)
      );
    }
    return this.assertFundingLedgerCoverage({
      receipts,
      affiliateRemittances,
      quotas,
      allocations
    });
  }

  assertFundingLedgerCoverage(input: {
    receipts: ReadonlyArray<{ amountCents: bigint }>;
    affiliateRemittances: ReadonlyArray<{
      amountCents: bigint;
      effectDirection: string;
    }>;
    quotas: ReadonlyArray<{ id: string; amountCents: bigint; status: string }>;
    allocations: readonly FundingAllocationRow[];
  }): ProjectFundingLedgerCoverage {
    const projectCashSourceAmountCents =
      sumDbMoneyToBigInt(
        input.receipts.map((receipt) => receipt.amountCents),
        "项目自有资金到账"
      ) +
      input.affiliateRemittances.reduce(
        (total, fact) => {
          if (
            fact.effectDirection !== "increase" &&
            fact.effectDirection !== "decrease"
          ) {
            throw new ConflictException("施工企业向我方拨款方向无效");
          }
          return total +
            (fact.effectDirection === "decrease" ? -1n : 1n) *
              dbMoneyToBigInt(fact.amountCents, "施工企业向我方拨款");
        },
        0n
      );
    if (projectCashSourceAmountCents < 0n) {
      throw new ConflictException("项目自有资金到账净额不能为负，请先核对资金事实");
    }
    const allocationSummary = this.summarizeAllocations(input.allocations);
    if (
      (allocationSummary.netUsedBySource.get("project_cash") ?? 0n) >
      projectCashSourceAmountCents
    ) {
      throw new ConflictException("项目自有资金占用超过当前确认资金来源");
    }
    const quotaBySource = new Map(input.quotas.map((quota) => {
      const amountCents = dbMoneyToBigInt(quota.amountCents, "项目垫资额度");
      if (amountCents <= 0n) {
        throw new ConflictException("项目垫资额度金额必须大于 0");
      }
      return [this.financingSourceKey(quota.id), {
        amountCents,
        status: quota.status
      }] as const;
    }));
    for (const [sourceKey, netUsedAmountCents] of allocationSummary.netUsedBySource) {
      if (sourceKey === "project_cash") continue;
      const quota = quotaBySource.get(sourceKey);
      if (!quota) {
        throw new ConflictException("项目垫资额度资金账本引用了不存在的额度");
      }
      if (quota.status !== "approved" && quota.status !== "terminated") {
        throw new ConflictException("项目垫资额度资金账本引用了未批准额度");
      }
      if (netUsedAmountCents > quota.amountCents) {
        throw new ConflictException("项目垫资额度占用超过批准金额");
      }
    }
    return { projectCashSourceAmountCents, allocationSummary };
  }

  async allocateExecution(
    tx: Prisma.TransactionClient,
    input: AllocateProjectFundingInput
  ): Promise<FundingAllocationResult> {
    this.assertAllocationInput(input);
    const existing = await tx.projectFundingAllocation.findMany({
      where: {
        executionType: input.executionType,
        executionId: input.executionId
      },
      orderBy: [{ direction: "asc" }, { sourceKey: "asc" }]
    });
    if (existing.length) {
      return this.replayResult(existing, input);
    }

    await this.lockActiveProject(tx, input.projectId);
    const quotas = await this.lockAvailableQuotas(tx, input.projectId);
    const {
      projectCashSourceAmountCents: projectCashReceipts,
      allocationSummary: { netUsedBySource }
    } = await this.assertPersistedProjectFundingLedgerCoverage(tx, input.projectId);
    const projectCashUsed = netUsedBySource.get("project_cash") ?? 0n;
    const projectCashAvailable = projectCashReceipts - projectCashUsed;
    let remaining = input.amountCents;
    const allocations: FundingAllocationFact[] = [];

    if (projectCashAvailable > 0n) {
      const amount =
        projectCashAvailable >= remaining ? remaining : projectCashAvailable;
      allocations.push({
        sourceType: "project_cash",
        sourceId: null,
        amountCents: amount
      });
      remaining -= amount;
    }

    let availableQuotaCents = 0n;
    for (const quota of quotas) {
      const sourceKey = this.financingSourceKey(quota.id);
      const quotaAmount = dbMoneyToBigInt(quota.amountCents, "项目垫资额度");
      const quotaUsed = netUsedBySource.get(sourceKey) ?? 0n;
      if (quotaUsed > quotaAmount) {
        throw new ConflictException("项目垫资额度占用超过批准金额");
      }
      const available = quotaAmount - quotaUsed;
      availableQuotaCents += available;
      if (remaining === 0n || available === 0n) continue;
      const amount = available >= remaining ? remaining : available;
      allocations.push({
        sourceType: "financing_quota",
        sourceId: quota.id,
        amountCents: amount
      });
      remaining -= amount;
    }

    if (remaining > 0n) {
      throw new BadRequestException(
        `项目可用资金不足，当前最多可实际支付 ${
          projectCashAvailable + availableQuotaCents
        } 分`
      );
    }

    await tx.projectFundingAllocation.createMany({
      data: allocations.map((allocation) => ({
        projectId: input.projectId,
        executionType: input.executionType,
        executionId: input.executionId,
        businessType: input.businessType,
        businessId: input.businessId,
        sourceType: allocation.sourceType,
        sourceKey: allocation.sourceId
          ? this.financingSourceKey(allocation.sourceId)
          : "project_cash",
        sourceId: allocation.sourceId,
        direction: "debit",
        amountCents: allocation.amountCents,
        occurredAt: input.occurredAt,
        createdByUserId: input.actorUserId,
        reversalKey: "original"
      }))
    });

    return this.result("allocated", allocations);
  }

  async reverseExecution(
    tx: Prisma.TransactionClient,
    input: ReverseProjectFundingInput
  ): Promise<FundingAllocationResult> {
    const reversalKey = input.reversalKey.trim();
    const reason = input.reason.trim();
    if (!reversalKey || reversalKey === "original" || !reason) {
      throw new BadRequestException("资金更正编号和原因不能为空");
    }
    if (input.amountCents !== undefined && input.amountCents <= 0n) {
      throw new BadRequestException("资金更正金额必须大于 0");
    }
    await this.lockActiveProject(tx, input.projectId);
    const allocations = await tx.projectFundingAllocation.findMany({
      where: {
        executionType: input.executionType,
        executionId: input.executionId
      },
      orderBy: [{ direction: "asc" }, { sourceKey: "asc" }]
    });
    const debits = allocations.filter(
      (row) => row.direction === "debit" && row.reversalKey === "original"
    );
    if (!debits.length || debits.some((row) => row.projectId !== input.projectId)) {
      throw new BadRequestException("未找到可更正的原始项目资金分配");
    }
    const existingCredits = allocations.filter(
      (row) => row.direction === "credit" && row.reversalKey === reversalKey
    );
    if (existingCredits.length) {
      const existingAmountCents = existingCredits.reduce(
        (total, row) =>
          total + dbMoneyToBigInt(row.amountCents, "项目资金反向分配金额"),
        0n
      );
      if (
        existingCredits.some((row) => row.projectId !== input.projectId) ||
        (input.amountCents !== undefined &&
          existingAmountCents !== input.amountCents)
      ) {
        throw new ConflictException("资金更正编号已用于其他金额或项目");
      }
      return this.result("replayed", this.facts(existingCredits));
    }

    const creditedByDebitId = new Map<string, bigint>();
    for (const credit of allocations) {
      if (credit.direction !== "credit" || !credit.reversalOfAllocationId) {
        continue;
      }
      creditedByDebitId.set(
        credit.reversalOfAllocationId,
        (creditedByDebitId.get(credit.reversalOfAllocationId) ?? 0n) +
          dbMoneyToBigInt(credit.amountCents, "项目资金反向分配金额")
      );
    }
    const debitAvailability = debits.map((debit) => ({
        debit,
        availableCents:
          dbMoneyToBigInt(debit.amountCents, "项目资金原始分配金额") -
          (creditedByDebitId.get(debit.id) ?? 0n)
      }));
    if (debitAvailability.some(({ availableCents }) => availableCents < 0n)) {
      throw new ConflictException("项目资金反向分配累计已超过原执行");
    }
    const availableDebits = debitAvailability
      .filter(({ availableCents }) => availableCents > 0n)
      .sort((left, right) => {
        const leftCash = left.debit.sourceType === "project_cash" ? 1 : 0;
        const rightCash = right.debit.sourceType === "project_cash" ? 1 : 0;
        return (
          leftCash - rightCash ||
          right.debit.sourceKey.localeCompare(left.debit.sourceKey)
        );
      });
    const availableTotalCents = availableDebits.reduce(
      (total, row) => total + row.availableCents,
      0n
    );
    const targetAmountCents = input.amountCents ?? availableTotalCents;
    if (targetAmountCents > availableTotalCents || targetAmountCents === 0n) {
      throw new BadRequestException(
        `资金更正金额超过原执行尚可冲销金额 ${availableTotalCents} 分`
      );
    }
    let remainingCents = targetAmountCents;
    const plannedCredits: Array<{
      debit: FundingAllocationRow;
      amountCents: bigint;
    }> = [];
    for (const row of availableDebits) {
      if (remainingCents === 0n) break;
      const amountCents =
        row.availableCents >= remainingCents
          ? remainingCents
          : row.availableCents;
      plannedCredits.push({ debit: row.debit, amountCents });
      remainingCents -= amountCents;
    }

    await tx.projectFundingAllocation.createMany({
      data: plannedCredits.map(({ debit, amountCents }) => ({
        projectId: debit.projectId,
        executionType: debit.executionType,
        executionId: debit.executionId,
        businessType: debit.businessType,
        businessId: debit.businessId,
        sourceType: debit.sourceType,
        sourceKey: debit.sourceKey,
        sourceId: debit.sourceId,
        direction: "credit",
        amountCents,
        occurredAt: input.occurredAt ?? new Date(),
        createdByUserId: input.actorUserId,
        reversalOfAllocationId: debit.id,
        reversalKey,
        reason
      }))
    });
    return this.result(
      "allocated",
      plannedCredits.map(({ debit, amountCents }) => ({
        sourceType: debit.sourceType as FundingSourceType,
        sourceId: debit.sourceId,
        amountCents
      }))
    );
  }

  summarizeAllocations(
    rows: readonly FundingAllocationRow[]
  ): ProjectFundingAllocationSummary {
    const debitBySource = new Map<string, bigint>();
    const creditBySource = new Map<string, bigint>();
    const debitById = new Map<string, FundingAllocationRow>();
    for (const row of rows) {
      const amountCents = dbMoneyToBigInt(row.amountCents, "项目资金分配金额");
      if (amountCents <= 0n || (row.direction !== "debit" && row.direction !== "credit")) {
        throw new ConflictException("项目资金分配账本存在无效金额或方向");
      }
      if (
        (row.sourceType === "project_cash" &&
          (row.sourceKey !== "project_cash" || row.sourceId !== null)) ||
        (row.sourceType === "financing_quota" &&
          (!row.sourceId || row.sourceKey !== this.financingSourceKey(row.sourceId))) ||
        (row.sourceType !== "project_cash" && row.sourceType !== "financing_quota")
      ) {
        throw new ConflictException("项目资金分配账本存在无效资金来源");
      }
      if (row.direction === "debit") {
        if (row.reversalOfAllocationId !== null || row.reversalKey !== "original") {
          throw new ConflictException("项目资金分配账本存在无效原始占用");
        }
        debitById.set(row.id, row);
      }
      const target = row.direction === "debit" ? debitBySource : creditBySource;
      target.set(row.sourceKey, (target.get(row.sourceKey) ?? 0n) + amountCents);
    }
    const creditedByDebitId = new Map<string, bigint>();
    for (const credit of rows.filter((row) => row.direction === "credit")) {
      if (!credit.reversalOfAllocationId || credit.reversalKey === "original") {
        throw new ConflictException("项目资金分配账本存在无效冲销记录");
      }
      const debit = debitById.get(credit.reversalOfAllocationId);
      if (!debit) {
        throw new ConflictException("项目资金分配账本冲销金额超过原始占用");
      }
      if (
        credit.projectId !== debit.projectId ||
        credit.executionType !== debit.executionType ||
        credit.executionId !== debit.executionId ||
        credit.businessType !== debit.businessType ||
        credit.businessId !== debit.businessId ||
        credit.sourceType !== debit.sourceType ||
        credit.sourceKey !== debit.sourceKey ||
        credit.sourceId !== debit.sourceId
      ) {
        throw new ConflictException("项目资金分配账本冲销记录与原始占用不一致");
      }
      const credited =
        (creditedByDebitId.get(debit.id) ?? 0n) +
        dbMoneyToBigInt(credit.amountCents, "项目资金分配金额");
      if (credited > dbMoneyToBigInt(debit.amountCents, "项目资金分配金额")) {
        throw new ConflictException("项目资金分配账本冲销金额超过原始占用");
      }
      creditedByDebitId.set(debit.id, credited);
    }
    const sourceKeys = new Set([...debitBySource.keys(), ...creditBySource.keys()]);
    const netUsedBySource = new Map<string, bigint>();
    for (const sourceKey of sourceKeys) {
      const netUsed =
        (debitBySource.get(sourceKey) ?? 0n) -
        (creditBySource.get(sourceKey) ?? 0n);
      if (netUsed < 0n) {
        throw new ConflictException("项目资金分配账本冲销金额超过原始占用");
      }
      netUsedBySource.set(sourceKey, netUsed);
    }
    return { debitBySource, creditBySource, netUsedBySource };
  }

  private async lockActiveProject(
    tx: Prisma.TransactionClient,
    projectId: string
  ) {
    const projects = await tx.$queryRaw<
      Array<{ id: string; isActive: boolean }>
    >(Prisma.sql`
      SELECT "id", "isActive"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `);
    if (!projects[0]?.isActive) {
      throw new BadRequestException("项目不存在或已停用，不能登记实际付款");
    }
  }

  private lockAvailableQuotas(
    tx: Prisma.TransactionClient,
    projectId: string
  ) {
    return tx.$queryRaw<Array<{ id: string; amountCents: bigint }>>(Prisma.sql`
      SELECT "id", "amountCents"
      FROM "ProjectFinancingQuota"
      WHERE "projectId" = ${projectId}
        AND "status" = 'approved'
        AND ("validUntil" IS NULL OR "validUntil" >= CURRENT_TIMESTAMP)
      ORDER BY "validUntil" ASC NULLS LAST, "id" ASC
      FOR UPDATE
    `);
  }

  private replayResult(
    rows: FundingAllocationRow[],
    input: AllocateProjectFundingInput
  ): FundingAllocationResult {
    const debits = rows.filter(
      (row) => row.direction === "debit" && row.reversalKey === "original"
    );
    const total = debits.reduce(
      (sum, row) => sum + dbMoneyToBigInt(row.amountCents, "项目资金分配金额"),
      0n
    );
    if (
      !debits.length ||
      total !== input.amountCents ||
      debits.some((row) =>
        row.projectId !== input.projectId ||
        row.businessType !== input.businessType ||
        row.businessId !== input.businessId
      )
    ) {
      throw new ConflictException("同一实付编号已绑定不同的项目资金事实");
    }
    return this.result("replayed", this.facts(debits));
  }

  private facts(rows: FundingAllocationRow[]): FundingAllocationFact[] {
    return rows.map((row) => ({
      sourceType: row.sourceType as FundingSourceType,
      sourceId: row.sourceId,
      amountCents: row.amountCents
    }));
  }

  private result(
    kind: "allocated" | "replayed",
    allocations: FundingAllocationFact[]
  ): FundingAllocationResult {
    return {
      kind,
      projectCashAmountCents: allocations
        .filter((row) => row.sourceType === "project_cash")
        .reduce((sum, row) => sum + row.amountCents, 0n),
      financingQuotaAmountCents: allocations
        .filter((row) => row.sourceType === "financing_quota")
        .reduce((sum, row) => sum + row.amountCents, 0n),
      allocations
    };
  }

  private assertAllocationInput(input: AllocateProjectFundingInput) {
    if (
      !input.projectId.trim() ||
      !input.executionId.trim() ||
      !input.businessType.trim() ||
      !input.businessId.trim() ||
      !input.actorUserId.trim() ||
      input.amountCents <= 0n ||
      Number.isNaN(input.occurredAt.getTime())
    ) {
      throw new BadRequestException("项目资金分配参数不完整");
    }
  }

  private financingSourceKey(quotaId: string) {
    return `financing_quota:${quotaId}`;
  }

}

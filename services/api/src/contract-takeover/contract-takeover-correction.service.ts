import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";
import { dbMoneyToBigInt } from "../money/decimal-money";
import {
  OperatingLedgerService,
  type AppendOperatingFactInput,
  type OperatingImpactInput,
  type OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import { CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE } from "./contract-takeover-operating-source.adapter";
import { ContractTakeoverBalanceService } from "./contract-takeover-balance.service";
import type { ReviewContractTakeoverCorrectionDto } from "./dto/review-contract-takeover-correction.dto";
import type {
  ContractTakeoverCorrectionScope,
  SubmitContractTakeoverCorrectionDto
} from "./dto/submit-contract-takeover-correction.dto";

const CONTRACT_SCOPES = new Set<ContractTakeoverCorrectionScope>([
  "historical_settlement"
]);
const FINANCE_SCOPES = new Set<ContractTakeoverCorrectionScope>([
  "historical_payment",
  "historical_advance",
  "abnormal_overpay"
]);
type BalanceType = "historical_advance" | "abnormal_overpay";

interface LockedTakeover {
  id: string;
  projectId: string;
  contractId: string;
  activatedAt: Date | null;
  historicalInitialSettlementId: string | null;
  historicalPaidCents: bigint;
  historicalAdvancePaidCents: bigint;
  historicalAdvanceDeductedCents: bigint;
}

interface LockedBalanceAccount {
  id: string;
  takeoverId: string;
  balanceType: BalanceType;
  openingCents: bigint;
  balanceCents: bigint;
  revision: number;
}

interface LockedAllocation {
  id: string;
  historicalPaymentId: string;
  allocationType: "settlement" | BalanceType;
  amountCents: bigint;
  takeoverId: string;
}

interface LockedBalanceEntry {
  id: string;
  accountId: string;
  entryKind: string;
  amountCents: bigint;
  reversesEntryId: string | null;
  balanceType: BalanceType;
  takeoverId: string;
  historicalPaymentId: string | null;
}

type Snapshot = Record<string, string | number | null>;

@Injectable()
export class ContractTakeoverCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly files: FileService,
    private readonly balances: ContractTakeoverBalanceService,
    @Optional() private readonly operatingLedger?: OperatingLedgerService
  ) {}

  async submit(
    projectId: string,
    takeoverId: string,
    actorUserId: string,
    input: SubmitContractTakeoverCorrectionDto
  ) {
    await this.auth.confirmPassword(
      actorUserId,
      required(input.currentPassword, "请填写当前登录密码后再提交历史更正")
    );
    const scope = input.correctionScope;
    const operation = input.correctionOperation;
    const reason = required(input.reason, "请填写更正原因");
    const responsibleUserId = required(
      input.responsibleUserId,
      "请填写更正责任人"
    );
    const attachmentFileId = required(
      input.attachmentFileId,
      "请上传独占的更正依据附件"
    );
    const applicationIdempotencyKey = required(
      input.applicationIdempotencyKey,
      "更正应用幂等键不能为空"
    );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing =
            await tx.contractTakeoverCorrection.findUnique({
              where: { applicationIdempotencyKey }
            });
          if (existing) {
            if (
              existing.projectId !== projectId ||
              existing.takeoverId !== takeoverId ||
              existing.schemaVersion !== 2
            ) {
              throw new ConflictException(
                "更正应用幂等键已用于其他历史更正"
              );
            }
            return { ...existing, repeated: true };
          }

          const takeover = await this.lockTakeover(
            tx,
            projectId,
            takeoverId
          );
          await this.assertSideRole(
            tx,
            projectId,
            actorUserId,
            this.sideForScope(scope),
            "submit"
          );
          const responsibleUser = await tx.user.findUnique({
            where: { id: responsibleUserId },
            select: { id: true, isActive: true }
          });
          if (!responsibleUser?.isActive) {
            throw new BadRequestException(
              "更正责任人不存在或已停用"
            );
          }
          await this.files.assertCanAttachUnlinkedFile(
            tx,
            attachmentFileId,
            actorUserId
          );

          const frozen = await this.freezeTarget(
            tx,
            takeover,
            input
          );
          const now = new Date();
          const correction =
            await tx.contractTakeoverCorrection.create({
              data: {
                projectId,
                takeoverId,
                schemaVersion: 2,
                correctionType: "amount",
                correctionScope: scope,
                correctionOperation: operation,
                status: "submitted",
                targetRevision: input.targetRevision,
                targetBalanceRevision:
                  input.targetBalanceRevision ?? null,
                targetHistoricalPaymentId:
                  frozen.targetHistoricalPaymentId,
                targetAllocationId: frozen.targetAllocationId,
                targetBalanceEntryId:
                  frozen.targetBalanceEntryId,
                beforeSnapshot: frozen.beforeSnapshot,
                deltaSnapshot: frozen.deltaSnapshot,
                afterSnapshot: frozen.afterSnapshot,
                reason,
                responsibleUserId,
                attachmentFileId,
                createdByUserId: actorUserId,
                submittedByUserId: actorUserId,
                submittedAt: now,
                applicationIdempotencyKey
              }
            });
          await this.audit.record(tx, {
            actorUserId,
            action: "contract_takeover.correction.submit",
            businessType: "contract_takeover",
            businessId: takeover.id,
            metadata: {
              correctionId: correction.id,
              schemaVersion: 2,
              scope,
              operation,
              targetRevision: input.targetRevision,
              targetBalanceRevision:
                input.targetBalanceRevision ?? null,
              attachmentFileId,
              applicationIdempotencyKey
            }
          });
          return { ...correction, repeated: false };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      this.rethrowTransactionError(error);
    }
  }

  async review(
    projectId: string,
    takeoverId: string,
    correctionId: string,
    actorUserId: string,
    input: ReviewContractTakeoverCorrectionDto
  ) {
    await this.auth.confirmPassword(
      actorUserId,
      required(input.currentPassword, "请填写当前登录密码后再复核历史更正")
    );
    const reviewComment = required(
      input.reviewComment,
      "请填写历史更正复核意见"
    );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const correction = await this.lockCorrection(
            tx,
            correctionId
          );
          if (
            !correction ||
            correction.projectId !== projectId ||
            correction.takeoverId !== takeoverId ||
            correction.schemaVersion !== 2
          ) {
            throw new BadRequestException(
              "未找到待复核的历史更正"
            );
          }
          if (
            correction.status === "applied" &&
            input.decision === "apply"
          ) {
            return { ...correction, repeated: true };
          }
          if (
            correction.status === "rejected" &&
            input.decision === "reject"
          ) {
            return { ...correction, repeated: true };
          }
          if (correction.status !== "submitted") {
            throw new ConflictException(
              "历史更正已被其他复核动作处理"
            );
          }
          if (correction.createdByUserId === actorUserId) {
            throw new ForbiddenException(
              "历史更正提交人不能复核本人提交的记录"
            );
          }
          const scope = this.parseScope(correction.correctionScope);
          await this.assertSideRole(
            tx,
            projectId,
            actorUserId,
            this.sideForScope(scope),
            "review"
          );
          const takeover = await this.lockTakeover(
            tx,
            projectId,
            takeoverId
          );
          const now = new Date();

          if (input.decision === "reject") {
            const rejected =
              await tx.contractTakeoverCorrection.updateMany({
                where: {
                  id: correction.id,
                  status: "submitted"
                },
                data: {
                  status: "rejected",
                  reviewedByUserId: actorUserId,
                  reviewedAt: now,
                  reviewComment
                }
              });
            if (rejected.count !== 1) {
              throw new ConflictException(
                "历史更正已被其他复核动作处理"
              );
            }
            await this.audit.record(tx, {
              actorUserId,
              action: "contract_takeover.correction.reject",
              businessType: "contract_takeover",
              businessId: takeover.id,
              metadata: {
                correctionId: correction.id,
                reviewComment
              }
            });
            return {
              id: correction.id,
              status: "rejected",
              repeated: false
            };
          }

          await this.applyCorrection(
            tx,
            takeover,
            correction,
            scope,
            actorUserId
          );
          const applied =
            await tx.contractTakeoverCorrection.updateMany({
              where: {
                id: correction.id,
                status: "submitted"
              },
              data: {
                status: "applied",
                reviewedByUserId: actorUserId,
                reviewedAt: now,
                reviewComment,
                appliedByUserId: actorUserId,
                appliedAt: now
              }
            });
          if (applied.count !== 1) {
            throw new ConflictException(
              "历史更正已被其他复核动作处理"
            );
          }
          await this.audit.record(tx, {
            actorUserId,
            action: "contract_takeover.correction.apply",
            businessType: "contract_takeover",
            businessId: takeover.id,
            metadata: {
              correctionId: correction.id,
              scope,
              operation: correction.correctionOperation,
              applicationIdempotencyKey:
                correction.applicationIdempotencyKey,
              reviewComment
            }
          });
          return {
            id: correction.id,
            status: "applied",
            repeated: false
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      this.rethrowTransactionError(error);
    }
  }

  private async freezeTarget(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    input: SubmitContractTakeoverCorrectionDto
  ): Promise<{
    beforeSnapshot: Prisma.InputJsonObject;
    deltaSnapshot: Prisma.InputJsonObject;
    afterSnapshot: Prisma.InputJsonObject;
    targetHistoricalPaymentId: string | null;
    targetAllocationId: string | null;
    targetBalanceEntryId: string | null;
  }> {
    const scope = input.correctionScope;
    if (input.correctionOperation === "reversal") {
      return this.freezeReversal(tx, takeover, input);
    }
    if (input.correctionOperation === "reclassification") {
      return this.freezeReclassification(tx, takeover, input);
    }
    const deltaCents = parseNonZeroDelta(input.deltaCents);
    if (scope === "historical_settlement") {
      const facts =
        await tx.contractTakeoverContractFacts.findUnique({
          where: { takeoverId: takeover.id },
          select: {
            revision: true,
            historicalSettledCents: true
          }
        });
      if (!facts || facts.revision !== input.targetRevision) {
        throw new ConflictException(
          "合同侧目标修订已变化，请刷新后重新提交更正"
        );
      }
      const beforeCents = dbMoneyToBigInt(
        facts.historicalSettledCents,
        "历史累计结算"
      );
      const afterCents = checkedAdd(
        beforeCents,
        deltaCents,
        "历史累计结算"
      );
      if (afterCents < 0n) {
        throw new BadRequestException(
          "更正后历史累计结算不能小于 0"
        );
      }
      return frozenMoney(beforeCents, deltaCents, afterCents, {
        revision: facts.revision
      });
    }
    if (scope === "historical_payment") {
      const allocation = await this.lockAllocation(
        tx,
        takeover.id,
        required(
          input.targetAllocationId,
          "历史实付更正必须引用原分配记录"
        )
      );
      const financeFacts =
        await tx.contractTakeoverFinanceFacts.findUnique({
          where: { takeoverId: takeover.id },
          select: { revision: true }
        });
      if (
        !financeFacts ||
        financeFacts.revision !== input.targetRevision
      ) {
        throw new ConflictException(
          "财务侧目标修订已变化，请刷新后重新提交更正"
        );
      }
      if (
        input.targetHistoricalPaymentId &&
        input.targetHistoricalPaymentId !==
          allocation.historicalPaymentId
      ) {
        throw new BadRequestException(
          "目标历史实付与原分配记录不一致"
        );
      }
      const priorDelta = await this.appliedAllocationDelta(
        tx,
        allocation.id
      );
      const beforeCents = checkedAdd(
        dbMoneyToBigInt(
          allocation.amountCents,
          "历史实付分配金额"
        ),
        priorDelta,
        "历史实付有效分配金额"
      );
      const afterCents = checkedAdd(
        beforeCents,
        deltaCents,
        "历史实付有效分配金额"
      );
      if (afterCents < 0n) {
        throw new BadRequestException(
          "更正后历史实付分配金额不能小于 0"
        );
      }
      let balanceSnapshot: Prisma.InputJsonObject = {};
      if (allocation.allocationType !== "settlement") {
        const account = await this.lockBalance(
          tx,
          takeover.id,
          allocation.allocationType
        );
        if (account.revision !== input.targetBalanceRevision) {
          throw new ConflictException(
            "目标余额修订已变化，请刷新后重新提交更正"
          );
        }
        balanceSnapshot = {
          balanceCents: dbMoneyToBigInt(
            account.balanceCents,
            "历史余额"
          ).toString(),
          balanceRevision: account.revision
        };
      }
      return {
        beforeSnapshot: {
          amountCents: beforeCents.toString(),
          allocationType: allocation.allocationType,
          financeRevision: financeFacts.revision,
          ...balanceSnapshot
        },
        deltaSnapshot: {
          amountCents: deltaCents.toString()
        },
        afterSnapshot: {
          amountCents: afterCents.toString(),
          allocationType: allocation.allocationType
        },
        targetHistoricalPaymentId:
          allocation.historicalPaymentId,
        targetAllocationId: allocation.id,
        targetBalanceEntryId: null
      };
    }
    const balance = await this.lockBalance(
      tx,
      takeover.id,
      this.parseBalanceType(scope)
    );
    const financeFacts =
      await tx.contractTakeoverFinanceFacts.findUnique({
        where: { takeoverId: takeover.id },
        select: { revision: true }
      });
    this.assertTargetRevisions(
      financeFacts?.revision,
      balance.revision,
      input.targetRevision,
      input.targetBalanceRevision
    );
    const beforeCents = dbMoneyToBigInt(
      balance.balanceCents,
      "历史余额"
    );
    const afterCents = checkedAdd(
      beforeCents,
      deltaCents,
      "历史余额"
    );
    if (afterCents < 0n) {
      throw new BadRequestException(
        "更正差额超过当前历史余额"
      );
    }
    return {
      ...frozenMoney(beforeCents, deltaCents, afterCents, {
        balanceRevision: balance.revision
      }),
      targetHistoricalPaymentId: null,
      targetAllocationId: null,
      targetBalanceEntryId: null
    };
  }

  private async freezeReclassification(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    input: SubmitContractTakeoverCorrectionDto
  ) {
    const sourceType = this.parseBalanceType(
      input.correctionScope
    );
    const targetType = input.reclassificationTarget;
    if (!targetType || targetType === sourceType) {
      throw new BadRequestException(
        "重分类必须选择不同的目标余额类型"
      );
    }
    const amountCents = parsePositiveDelta(input.deltaCents);
    const allocation = await this.lockAllocation(
      tx,
      takeover.id,
      required(
        input.targetAllocationId,
        "重分类必须引用原历史实付分配记录"
      )
    );
    if (allocation.allocationType !== sourceType) {
      throw new BadRequestException(
        "重分类来源与原历史实付分配类型不一致"
      );
    }
    const source = await this.lockBalance(
      tx,
      takeover.id,
      sourceType
    );
    const financeFacts =
      await tx.contractTakeoverFinanceFacts.findUnique({
        where: { takeoverId: takeover.id },
        select: { revision: true }
      });
    this.assertTargetRevisions(
      financeFacts?.revision,
      source.revision,
      input.targetRevision,
      input.targetBalanceRevision
    );
    const sourceBefore = dbMoneyToBigInt(
      source.balanceCents,
      "重分类来源余额"
    );
    if (amountCents > sourceBefore) {
      throw new BadRequestException(
        "重分类金额超过当前来源余额"
      );
    }
    return {
      beforeSnapshot: {
        sourceType,
        sourceBalanceCents: sourceBefore.toString(),
        sourceBalanceRevision: source.revision,
        targetType
      },
      deltaSnapshot: {
        amountCents: amountCents.toString(),
        from: sourceType,
        to: targetType
      },
      afterSnapshot: {
        sourceType,
        sourceBalanceCents: (
          sourceBefore - amountCents
        ).toString(),
        targetType
      },
      targetHistoricalPaymentId:
        allocation.historicalPaymentId,
      targetAllocationId: allocation.id,
      targetBalanceEntryId: null
    };
  }

  private async freezeReversal(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    input: SubmitContractTakeoverCorrectionDto
  ) {
    const entryId = required(
      input.targetBalanceEntryId,
      "反向更正必须引用原余额流水"
    );
    const entry = await this.lockBalanceEntry(
      tx,
      takeover.id,
      entryId
    );
    const scope = this.parseBalanceType(input.correctionScope);
    if (entry.balanceType !== scope) {
      throw new BadRequestException(
        "反向更正范围与原余额流水不一致"
      );
    }
    if (entry.entryKind !== "deduction") {
      throw new BadRequestException(
        "当前仅允许精确反向未反向的历史预付款抵扣流水"
      );
    }
    const account = await this.lockBalance(
      tx,
      takeover.id,
      entry.balanceType
    );
    const financeFacts =
      await tx.contractTakeoverFinanceFacts.findUnique({
        where: { takeoverId: takeover.id },
        select: { revision: true }
      });
    this.assertTargetRevisions(
      financeFacts?.revision,
      account.revision,
      input.targetRevision,
      input.targetBalanceRevision
    );
    const amountCents = dbMoneyToBigInt(
      entry.amountCents,
      "反向流水金额"
    );
    const beforeCents = dbMoneyToBigInt(
      account.balanceCents,
      "反向前余额"
    );
    return {
      beforeSnapshot: {
        balanceCents: beforeCents.toString(),
        balanceRevision: account.revision,
        originalEntryKind: entry.entryKind,
        originalEntryAmountCents: amountCents.toString()
      },
      deltaSnapshot: {
        amountCents: amountCents.toString(),
        reversesEntryId: entry.id
      },
      afterSnapshot: {
        balanceCents: checkedAdd(
          beforeCents,
          amountCents,
          "反向后余额"
        ).toString()
      },
      targetHistoricalPaymentId: entry.historicalPaymentId,
      targetAllocationId: null,
      targetBalanceEntryId: entry.id
    };
  }

  private async applyCorrection(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    correction: {
      id: string;
      correctionOperation: string | null;
      targetRevision: number | null;
      targetBalanceRevision: number | null;
      targetHistoricalPaymentId: string | null;
      targetAllocationId: string | null;
      targetBalanceEntryId: string | null;
      beforeSnapshot: Prisma.JsonValue;
      deltaSnapshot: Prisma.JsonValue | null;
      afterSnapshot: Prisma.JsonValue;
      applicationIdempotencyKey: string | null;
    },
    scope: ContractTakeoverCorrectionScope,
    actorUserId: string
  ) {
    const applicationIdempotencyKey = required(
      correction.applicationIdempotencyKey,
      "历史更正缺少应用幂等键"
    );
    if (correction.correctionOperation === "reversal") {
      const entryId = required(
        correction.targetBalanceEntryId,
        "历史反向更正缺少原流水"
      );
      await this.assertCurrentBalanceRevision(
        tx,
        takeover.id,
        this.parseBalanceType(scope),
        correction.targetBalanceRevision
      );
      await this.balances.reverseEntryInTransaction(
        tx,
        entryId,
        actorUserId,
        `${applicationIdempotencyKey}:reversal`,
        correction.id
      );
      await this.appendOperatingCorrection(
        tx,
        takeover,
        correction,
        scope,
        actorUserId,
        applicationIdempotencyKey,
        "reversal"
      );
      return;
    }
    if (correction.correctionOperation === "reclassification") {
      await this.applyReclassification(
        tx,
        takeover,
        correction,
        scope,
        actorUserId,
        applicationIdempotencyKey
      );
      await this.appendOperatingCorrection(
        tx,
        takeover,
        correction,
        scope,
        actorUserId,
        applicationIdempotencyKey,
        "correction"
      );
      return;
    }
    const deltaCents = jsonMoney(
      correction.deltaSnapshot,
      "amountCents",
      "历史更正差额"
    );
    if (scope === "historical_settlement") {
      await this.applySettlementCorrection(
        tx,
        takeover,
        correction,
        deltaCents,
        actorUserId
      );
      await this.appendOperatingCorrection(
        tx,
        takeover,
        correction,
        scope,
        actorUserId,
        applicationIdempotencyKey,
        "correction"
      );
      return;
    }
    if (scope === "historical_payment") {
      await this.applyPaymentCorrection(
        tx,
        takeover,
        correction,
        deltaCents,
        actorUserId,
        applicationIdempotencyKey
      );
      await this.appendOperatingCorrection(
        tx,
        takeover,
        correction,
        scope,
        actorUserId,
        applicationIdempotencyKey,
        "correction"
      );
      return;
    }
    await this.applyBalanceCorrection(
      tx,
      takeover,
      correction,
      this.parseBalanceType(scope),
      deltaCents,
      actorUserId,
      applicationIdempotencyKey
    );
    await this.appendOperatingCorrection(
      tx,
      takeover,
      correction,
      scope,
      actorUserId,
      applicationIdempotencyKey,
      "correction"
    );
  }

  private async applyBalanceCorrection(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    correction: {
      id: string;
      targetRevision: number | null;
      targetBalanceRevision: number | null;
      beforeSnapshot: Prisma.JsonValue;
    },
    balanceType: BalanceType,
    deltaCents: bigint,
    actorUserId: string,
    idempotencyKey: string
  ) {
    const financeFacts =
      await tx.contractTakeoverFinanceFacts.findUnique({
        where: { takeoverId: takeover.id },
        select: { revision: true }
      });
    const account = await this.lockBalance(
      tx,
      takeover.id,
      balanceType
    );
    this.assertTargetRevisions(
      financeFacts?.revision,
      account.revision,
      correction.targetRevision,
      correction.targetBalanceRevision
    );
    const balanceBeforeCents = dbMoneyToBigInt(
      account.balanceCents,
      "历史余额"
    );
    const frozenBefore = jsonMoney(
      correction.beforeSnapshot,
      "balanceCents",
      "更正冻结余额"
    );
    if (balanceBeforeCents !== frozenBefore) {
      throw new ConflictException(
        "历史余额已变化，请重新提交更正"
      );
    }
    const balanceAfterCents = checkedAdd(
      balanceBeforeCents,
      deltaCents,
      "更正后历史余额"
    );
    if (balanceAfterCents < 0n) {
      throw new BadRequestException(
        "更正差额超过当前历史余额"
      );
    }
    const amountCents = absolute(deltaCents);
    const historicalPaidCents = dbMoneyToBigInt(
      takeover.historicalPaidCents,
      "历史累计已付"
    );
    if (
      checkedAdd(
        historicalPaidCents,
        deltaCents,
        "更正后历史累计已付"
      ) < 0n
    ) {
      throw new BadRequestException(
        "更正后历史累计已付不能小于 0"
      );
    }
    if (
      balanceType === "historical_advance" &&
      checkedAdd(
        dbMoneyToBigInt(
          takeover.historicalAdvancePaidCents,
          "历史预付款已付"
        ),
        deltaCents,
        "更正后历史预付款已付"
      ) < 0n
    ) {
      throw new BadRequestException(
        "更正后历史预付款已付不能小于 0"
      );
    }
    await tx.contractTakeoverBalanceEntry.create({
      data: {
        accountId: account.id,
        entryKind: "correction",
        amountCents,
        correctionId: correction.id,
        idempotencyKey: `${idempotencyKey}:ledger:${balanceType}`,
        createdByUserId: actorUserId
      }
    });
    const updated =
      await tx.contractTakeoverBalanceAccount.updateMany({
        where: {
          id: account.id,
          revision: account.revision,
          balanceCents: account.balanceCents
        },
        data: {
          balanceCents: balanceAfterCents,
          revision: { increment: 1 }
        }
      });
    if (updated.count !== 1) {
      throw new ConflictException(
        "历史余额并发变化，更正应用已中止"
      );
    }
    const parentData: Prisma.ContractTakeoverUpdateManyMutationInput =
      {
        historicalPaidCents: { increment: deltaCents }
      };
    if (balanceType === "historical_advance") {
      parentData.historicalAdvancePaidCents = {
        increment: deltaCents
      };
    }
    const parentUpdated = await tx.contractTakeover.updateMany({
      where: { id: takeover.id },
      data: parentData
    });
    if (parentUpdated.count !== 1) {
      throw new ConflictException(
        "历史接管累计金额并发变化，更正应用已中止"
      );
    }
  }

  private async appendOperatingCorrection(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    correction: {
      id: string;
      correctionOperation: string | null;
      targetHistoricalPaymentId: string | null;
      beforeSnapshot: Prisma.JsonValue;
      deltaSnapshot: Prisma.JsonValue | null;
    },
    scope: ContractTakeoverCorrectionScope,
    actorUserId: string,
    idempotencyKey: string,
    entryKind: "correction" | "reversal"
  ) {
    if (!this.operatingLedger) return;
    const project = await tx.project.findUnique({
      where: { id: takeover.projectId },
      select: { operatingLedgerEffectiveDate: true }
    });
    if (!project?.operatingLedgerEffectiveDate) return;

    const sourceType =
      scope === "historical_settlement"
        ? "settlement"
        : CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE;
    const sourceBusinessId =
      scope === "historical_settlement"
        ? takeover.historicalInitialSettlementId
        : correction.targetHistoricalPaymentId ??
          (
            await tx.$queryRaw<Array<{ historicalPaymentId: string }>>(
              Prisma.sql`
                SELECT allocation."historicalPaymentId"
                FROM "ContractTakeoverHistoricalPaymentAllocation" allocation
                JOIN "ContractTakeoverHistoricalPayment" payment
                  ON payment."id" = allocation."historicalPaymentId"
                WHERE payment."takeoverId" = ${takeover.id}
                  AND payment."status" = 'activated'
                  AND allocation."allocationType" = ${scope}
                ORDER BY payment."sequenceNo", allocation."allocationOrder"
                LIMIT 1
              `
            )
          )[0]?.historicalPaymentId;
    if (!sourceBusinessId) {
      throw new ConflictException("历史更正缺少可追溯的经营来源");
    }
    const original = await tx.operatingFact.findUnique({
      where: {
        sourceType_sourceBusinessId: { sourceType, sourceBusinessId }
      },
      include: { impacts: true }
    });
    if (!original || original.entryKind !== "original") {
      throw new ConflictException("历史更正对应的原经营事实不存在");
    }

    const delta = correctionDelta(correction.deltaSnapshot);
    const before = asObject(correction.beforeSnapshot, "历史更正前快照");
    const allocationType =
      typeof before.allocationType === "string"
        ? before.allocationType
        : null;
    const reclassification =
      correction.correctionOperation === "reclassification"
        ? asObject(correction.deltaSnapshot, "历史重分类差额")
        : null;
    const impacts = operatingCorrectionImpacts(
      original.impacts,
      scope,
      allocationType ?? scope,
      delta,
      reclassification
    );
    if (!impacts.length) {
      throw new ConflictException("历史更正没有可投影的经营影响");
    }

    await this.operatingLedger.appendCorrectionInTransaction(
      tx,
      {
        projectId: original.projectId,
        sourceType,
        sourceBusinessId: correction.id,
        sourceBusinessCode: `${original.sourceBusinessCode}/更正/${correction.id}`,
        sourceVersion: original.sourceVersion,
        idempotencyKey: `${idempotencyKey}:operating:${entryKind}`,
        occurredAt: new Date(),
        confirmedAt: new Date(),
        confirmedByUserId: actorUserId,
        factKind: original.factKind as AppendOperatingFactInput["factKind"],
        operatingLevel:
          original.operatingLevel as AppendOperatingFactInput["operatingLevel"],
        evidenceLevel: original.evidenceLevel as AppendOperatingFactInput["evidenceLevel"],
        amountCents: absBigInt(delta),
        currencyCode: original.currencyCode,
        direction: correctionDirection(original.direction, delta),
        isBeforeOperatingLedgerEffectiveDate:
          original.isBeforeOperatingLedgerEffectiveDate,
        affiliateAssignmentId: original.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: original.affiliateBusinessPartyVersionId,
        affiliateNameSnapshot: original.affiliateNameSnapshot,
        ...(original.affiliateCreditCodeSnapshot
          ? { affiliateCreditCodeSnapshot: original.affiliateCreditCodeSnapshot }
          : {}),
        ...(original.historicalTakeoverBatchId
          ? { historicalTakeoverBatchId: original.historicalTakeoverBatchId }
          : {}),
        sourceSnapshot: {
          authority: "contract_takeover_append_only_correction",
          correctionId: correction.id,
          correctionOperation: correction.correctionOperation,
          correctionScope: scope,
          originalSourceType: sourceType,
          originalSourceBusinessId: sourceBusinessId
        },
        basisSnapshot: {
          authority: "contract_takeover_correction_review",
          correctionId: correction.id
        },
        subjects: operatingSubjects(original),
        impacts,
        adjustsFactId: original.id
      },
      actorUserId
    );
  }

  private async applySettlementCorrection(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    correction: {
      targetRevision: number | null;
      beforeSnapshot: Prisma.JsonValue;
    },
    deltaCents: bigint,
    actorUserId: string
  ) {
    const facts =
      await tx.contractTakeoverContractFacts.findUnique({
        where: { takeoverId: takeover.id },
        select: {
          revision: true,
          financeBasisRevision: true,
          historicalSettledCents: true
        }
      });
    if (
      !facts ||
      facts.revision !== correction.targetRevision
    ) {
      throw new ConflictException(
        "合同侧目标修订已变化，请重新提交更正"
      );
    }
    const beforeCents = dbMoneyToBigInt(
      facts.historicalSettledCents,
      "历史累计结算"
    );
    if (
      beforeCents !==
      jsonMoney(
        correction.beforeSnapshot,
        "amountCents",
        "更正冻结结算金额"
      )
    ) {
      throw new ConflictException(
        "历史累计结算已变化，请重新提交更正"
      );
    }
    const afterCents = checkedAdd(
      beforeCents,
      deltaCents,
      "更正后历史累计结算"
    );
    if (afterCents < 0n) {
      throw new BadRequestException(
        "更正后历史累计结算不能小于 0"
      );
    }
    const settlementId = required(
      takeover.historicalInitialSettlementId,
      "当前接管没有历史期初结算，不能应用结算金额更正"
    );
    const settlement = await tx.settlement.findUnique({
      where: { id: settlementId },
      select: {
        amountCents: true,
        payableAmountCents: true
      }
    });
    if (!settlement) {
      throw new ConflictException("历史期初结算不存在");
    }
    const settlementAmount = dbMoneyToBigInt(
      settlement.amountCents,
      "历史期初结算金额"
    );
    const settlementPayable = dbMoneyToBigInt(
      settlement.payableAmountCents,
      "历史期初结算可付金额"
    );
    const nextPayable = checkedAdd(
      settlementPayable,
      deltaCents,
      "历史期初结算可付金额"
    );
    if (
      checkedAdd(
        settlementAmount,
        deltaCents,
        "历史期初结算金额"
      ) < 0n ||
      nextPayable < 0n
    ) {
      throw new BadRequestException(
        "结算更正超过历史期初结算剩余金额"
      );
    }
    const settlementUpdated = await tx.settlement.updateMany({
      where: {
        id: settlementId,
        amountCents: settlement.amountCents,
        payableAmountCents: settlement.payableAmountCents
      },
      data: {
        amountCents: { increment: deltaCents },
        payableAmountCents: { increment: deltaCents }
      }
    });
    if (settlementUpdated.count !== 1) {
      throw new ConflictException(
        "历史期初结算并发变化，更正应用已中止"
      );
    }
    const factsUpdated =
      await tx.contractTakeoverContractFacts.updateMany({
        where: {
          takeoverId: takeover.id,
          revision: facts.revision,
          historicalSettledCents:
            facts.historicalSettledCents
        },
        data: {
          revision: { increment: 1 },
          financeBasisRevision: { increment: 1 },
          historicalSettledCents: afterCents,
          zeroSettlementDeclared: afterCents === 0n,
          confirmedRevision: facts.revision + 1,
          confirmedByUserId: actorUserId,
          confirmedAt: new Date()
        }
      });
    const parentUpdated = await tx.contractTakeover.updateMany({
      where: { id: takeover.id },
      data: {
        historicalSettledCents: afterCents
      }
    });
    if (
      factsUpdated.count !== 1 ||
      parentUpdated.count !== 1
    ) {
      throw new ConflictException(
        "历史结算父级缓存并发变化，更正应用已中止"
      );
    }
  }

  private async applyPaymentCorrection(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    correction: {
      id: string;
      targetRevision: number | null;
      targetBalanceRevision: number | null;
      targetAllocationId: string | null;
      beforeSnapshot: Prisma.JsonValue;
    },
    deltaCents: bigint,
    actorUserId: string,
    idempotencyKey: string
  ) {
    const allocation = await this.lockAllocation(
      tx,
      takeover.id,
      required(
        correction.targetAllocationId,
        "历史实付更正缺少原分配记录"
      )
    );
    const financeFacts =
      await tx.contractTakeoverFinanceFacts.findUnique({
        where: { takeoverId: takeover.id },
        select: { revision: true }
      });
    if (
      !financeFacts ||
      financeFacts.revision !== correction.targetRevision
    ) {
      throw new ConflictException(
        "财务侧目标修订已变化，请重新提交更正"
      );
    }
    const currentEffective = checkedAdd(
      dbMoneyToBigInt(
        allocation.amountCents,
        "历史实付分配金额"
      ),
      await this.appliedAllocationDelta(tx, allocation.id),
      "历史实付有效分配金额"
    );
    if (
      currentEffective !==
      jsonMoney(
        correction.beforeSnapshot,
        "amountCents",
        "更正冻结实付金额"
      )
    ) {
      throw new ConflictException(
        "历史实付有效金额已变化，请重新提交更正"
      );
    }
    if (
      checkedAdd(
        currentEffective,
        deltaCents,
        "更正后历史实付金额"
      ) < 0n
    ) {
      throw new BadRequestException(
        "更正后历史实付金额不能小于 0"
      );
    }
    if (allocation.allocationType === "settlement") {
      const settlementId = required(
        takeover.historicalInitialSettlementId,
        "历史实付结算分配缺少期初结算"
      );
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId },
        select: { paidAmountCents: true }
      });
      if (!settlement) {
        throw new ConflictException("历史期初结算不存在");
      }
      const paidAfter = checkedAdd(
        dbMoneyToBigInt(
          settlement.paidAmountCents,
          "历史期初结算已付"
        ),
        deltaCents,
        "历史期初结算已付"
      );
      if (paidAfter < 0n) {
        throw new BadRequestException(
          "更正后历史期初结算已付不能小于 0"
        );
      }
      const updated = await tx.settlement.updateMany({
        where: {
          id: settlementId,
          paidAmountCents: settlement.paidAmountCents
        },
        data: { paidAmountCents: paidAfter }
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          "历史期初结算已付并发变化，更正应用已中止"
        );
      }
    } else {
      await this.applyBalanceCorrection(
        tx,
        takeover,
        correction,
        allocation.allocationType,
        deltaCents,
        actorUserId,
        idempotencyKey
      );
      return;
    }
    const parentUpdated = await tx.contractTakeover.updateMany({
      where: { id: takeover.id },
      data: {
        historicalPaidCents: { increment: deltaCents }
      }
    });
    if (parentUpdated.count !== 1) {
      throw new ConflictException(
        "历史已付累计并发变化，更正应用已中止"
      );
    }
  }

  private async applyReclassification(
    tx: Prisma.TransactionClient,
    takeover: LockedTakeover,
    correction: {
      id: string;
      targetRevision: number | null;
      targetBalanceRevision: number | null;
      targetAllocationId: string | null;
      deltaSnapshot: Prisma.JsonValue | null;
    },
    scope: ContractTakeoverCorrectionScope,
    actorUserId: string,
    idempotencyKey: string
  ) {
    const sourceType = this.parseBalanceType(scope);
    const delta = asObject(
      correction.deltaSnapshot,
      "重分类差额"
    );
    const targetType = this.parseBalanceType(delta.to);
    if (sourceType === targetType) {
      throw new BadRequestException(
        "重分类来源与目标不能相同"
      );
    }
    const amountCents = jsonMoney(
      correction.deltaSnapshot,
      "amountCents",
      "重分类金额"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException(
        "重分类金额必须大于 0"
      );
    }
    const allocation = await this.lockAllocation(
      tx,
      takeover.id,
      required(
        correction.targetAllocationId,
        "重分类缺少原历史实付分配记录"
      )
    );
    if (allocation.allocationType !== sourceType) {
      throw new ConflictException(
        "原历史实付分配类型已变化"
      );
    }
    const financeFacts =
      await tx.contractTakeoverFinanceFacts.findUnique({
        where: { takeoverId: takeover.id },
        select: { revision: true }
      });
    const source = await this.lockBalance(
      tx,
      takeover.id,
      sourceType
    );
    this.assertTargetRevisions(
      financeFacts?.revision,
      source.revision,
      correction.targetRevision,
      correction.targetBalanceRevision
    );
    const sourceAfter = dbMoneyToBigInt(
      source.balanceCents,
      "重分类来源余额"
    ) - amountCents;
    if (sourceAfter < 0n) {
      throw new BadRequestException(
        "重分类金额超过当前来源余额"
      );
    }
    const target =
      await tx.contractTakeoverBalanceAccount.upsert({
        where: {
          takeoverId_balanceType: {
            takeoverId: takeover.id,
            balanceType: targetType
          }
        },
        create: {
          takeoverId: takeover.id,
          balanceType: targetType,
          openingCents: 0n,
          balanceCents: 0n
        },
        update: {},
        select: {
          id: true,
          balanceCents: true,
          revision: true
        }
      });
    const targetBefore = dbMoneyToBigInt(
      target.balanceCents,
      "重分类目标余额"
    );
    await tx.contractTakeoverBalanceEntry.create({
      data: {
        accountId: source.id,
        entryKind: "reclassification",
        amountCents,
        historicalPaymentId:
          allocation.historicalPaymentId,
        correctionId: correction.id,
        idempotencyKey: `${idempotencyKey}:reclassification:from`,
        createdByUserId: actorUserId
      }
    });
    await tx.contractTakeoverBalanceEntry.create({
      data: {
        accountId: target.id,
        entryKind: "reclassification",
        amountCents,
        historicalPaymentId:
          allocation.historicalPaymentId,
        correctionId: correction.id,
        idempotencyKey: `${idempotencyKey}:reclassification:to`,
        createdByUserId: actorUserId
      }
    });
    const sourceUpdated =
      await tx.contractTakeoverBalanceAccount.updateMany({
        where: {
          id: source.id,
          revision: source.revision,
          balanceCents: source.balanceCents
        },
        data: {
          balanceCents: sourceAfter,
          revision: { increment: 1 }
        }
      });
    const targetUpdated =
      await tx.contractTakeoverBalanceAccount.updateMany({
        where: {
          id: target.id,
          revision: target.revision,
          balanceCents: target.balanceCents
        },
        data: {
          balanceCents: checkedAdd(
            targetBefore,
            amountCents,
            "重分类目标余额"
          ),
          revision: { increment: 1 }
        }
      });
    if (
      sourceUpdated.count !== 1 ||
      targetUpdated.count !== 1
    ) {
      throw new ConflictException(
        "历史余额并发变化，重分类应用已中止"
      );
    }
    const advanceDelta =
      targetType === "historical_advance"
        ? amountCents
        : -amountCents;
    if (
      checkedAdd(
        dbMoneyToBigInt(
          takeover.historicalAdvancePaidCents,
          "历史预付款已付"
        ),
        advanceDelta,
        "重分类后历史预付款已付"
      ) < 0n
    ) {
      throw new BadRequestException(
        "重分类后历史预付款已付不能小于 0"
      );
    }
    const parentUpdated = await tx.contractTakeover.updateMany({
      where: { id: takeover.id },
      data: {
        historicalAdvancePaidCents: {
          increment: advanceDelta
        }
      }
    });
    if (parentUpdated.count !== 1) {
      throw new ConflictException(
        "历史接管累计金额并发变化，重分类应用已中止"
      );
    }
  }

  private async lockTakeover(
    tx: Prisma.TransactionClient,
    projectId: string,
    takeoverId: string
  ) {
    const [takeover] = await tx.$queryRaw<LockedTakeover[]>(
      Prisma.sql`
        SELECT
          "id",
          "projectId",
          "contractId",
          "activatedAt",
          "historicalInitialSettlementId",
          "historicalPaidCents",
          "historicalAdvancePaidCents",
          "historicalAdvanceDeductedCents"
        FROM "ContractTakeover"
        WHERE "id" = ${takeoverId}
          AND "projectId" = ${projectId}
        FOR UPDATE
      `
    );
    if (!takeover) {
      throw new BadRequestException("历史接管记录不存在");
    }
    if (!takeover.activatedAt) {
      throw new ConflictException(
        "历史接管尚未激活，不能发起激活后更正"
      );
    }
    return takeover;
  }

  private async lockCorrection(
    tx: Prisma.TransactionClient,
    correctionId: string
  ) {
    const [correction] = await tx.$queryRaw<
      Array<
        NonNullable<
          Awaited<
            ReturnType<
              typeof tx.contractTakeoverCorrection.findUnique
            >
          >
        >
      >
    >(Prisma.sql`
      SELECT *
      FROM "ContractTakeoverCorrection"
      WHERE "id" = ${correctionId}
      FOR UPDATE
    `);
    return correction ?? null;
  }

  private async lockBalance(
    tx: Prisma.TransactionClient,
    takeoverId: string,
    balanceType: BalanceType
  ) {
    const [account] = await tx.$queryRaw<
      LockedBalanceAccount[]
    >(Prisma.sql`
      SELECT
        "id",
        "takeoverId",
        "balanceType",
        "openingCents",
        "balanceCents",
        "revision"
      FROM "ContractTakeoverBalanceAccount"
      WHERE "takeoverId" = ${takeoverId}
        AND "balanceType" = ${balanceType}
      FOR UPDATE
    `);
    if (!account) {
      throw new BadRequestException(
        balanceType === "historical_advance"
          ? "当前接管没有历史预付款余额"
          : "当前接管没有异常超付余额"
      );
    }
    return account;
  }

  private async lockAllocation(
    tx: Prisma.TransactionClient,
    takeoverId: string,
    allocationId: string
  ) {
    const [allocation] = await tx.$queryRaw<LockedAllocation[]>(
      Prisma.sql`
        SELECT
          allocation."id",
          allocation."historicalPaymentId",
          allocation."allocationType",
          allocation."amountCents",
          payment."takeoverId"
        FROM "ContractTakeoverHistoricalPaymentAllocation"
          allocation
        JOIN "ContractTakeoverHistoricalPayment" payment
          ON payment."id" = allocation."historicalPaymentId"
        WHERE allocation."id" = ${allocationId}
          AND payment."takeoverId" = ${takeoverId}
        FOR UPDATE OF allocation, payment
      `
    );
    if (!allocation) {
      throw new BadRequestException(
        "目标历史实付分配记录不存在"
      );
    }
    return allocation;
  }

  private async lockBalanceEntry(
    tx: Prisma.TransactionClient,
    takeoverId: string,
    entryId: string
  ) {
    const [entry] = await tx.$queryRaw<LockedBalanceEntry[]>(
      Prisma.sql`
        SELECT
          entry."id",
          entry."accountId",
          entry."entryKind",
          entry."amountCents",
          entry."reversesEntryId",
          entry."historicalPaymentId",
          account."balanceType",
          account."takeoverId"
        FROM "ContractTakeoverBalanceEntry" entry
        JOIN "ContractTakeoverBalanceAccount" account
          ON account."id" = entry."accountId"
        WHERE entry."id" = ${entryId}
          AND account."takeoverId" = ${takeoverId}
        FOR UPDATE OF entry, account
      `
    );
    if (!entry) {
      throw new BadRequestException(
        "目标历史余额流水不存在"
      );
    }
    return entry;
  }

  private async appliedAllocationDelta(
    tx: Prisma.TransactionClient,
    allocationId: string
  ) {
    const corrections =
      await tx.contractTakeoverCorrection.findMany({
        where: {
          schemaVersion: 2,
          status: "applied",
          correctionScope: "historical_payment",
          correctionOperation: "correction",
          targetAllocationId: allocationId
        },
        select: { deltaSnapshot: true }
      });
    return corrections.reduce(
      (total, correction) =>
        checkedAdd(
          total,
          jsonMoney(
            correction.deltaSnapshot,
            "amountCents",
            "历史实付既有更正差额"
          ),
          "历史实付累计更正"
        ),
      0n
    );
  }

  private async assertCurrentBalanceRevision(
    tx: Prisma.TransactionClient,
    takeoverId: string,
    balanceType: BalanceType,
    expectedRevision: number | null
  ) {
    const account = await this.lockBalance(
      tx,
      takeoverId,
      balanceType
    );
    if (account.revision !== expectedRevision) {
      throw new ConflictException(
        "目标余额修订已变化，请重新提交更正"
      );
    }
  }

  private assertTargetRevisions(
    actualFactRevision: number | undefined,
    actualBalanceRevision: number,
    targetRevision: number | null | undefined,
    targetBalanceRevision: number | null | undefined
  ) {
    if (actualFactRevision !== targetRevision) {
      throw new ConflictException(
        "财务侧目标修订已变化，请刷新后重新提交更正"
      );
    }
    if (actualBalanceRevision !== targetBalanceRevision) {
      throw new ConflictException(
        "目标余额修订已变化，请刷新后重新提交更正"
      );
    }
  }

  private async assertSideRole(
    tx: Prisma.TransactionClient,
    projectId: string,
    actorUserId: string,
    side: "contract" | "finance",
    action: "submit" | "review"
  ) {
    const [assignments, memberships] = await Promise.all([
      tx.userPosition.findMany({
        where: {
          userId: actorUserId,
          OR: [{ projectId: null }, { projectId }]
        },
        select: { positionId: true }
      }),
      tx.projectMember.findMany({
        where: { projectId, userId: actorUserId },
        select: { positionKey: true }
      })
    ]);
    const positions = assignments.length
      ? await tx.position.findMany({
          where: {
            id: {
              in: assignments.map(
                (assignment) => assignment.positionId
              )
            }
          },
          select: { key: true }
        })
      : [];
    const keys = new Set([
      ...positions.map((position) => position.key),
      ...memberships.map(
        (membership) => membership.positionKey
      )
    ]);
    const allowed =
      action === "review"
        ? new Set([
            side === "contract"
              ? "contract_director"
              : "finance_director"
          ])
        : side === "contract"
          ? new Set(["contract_staff", "contract_director"])
          : new Set(["finance_staff", "finance_director"]);
    if (![...keys].some((key) => allowed.has(key))) {
      throw new ForbiddenException(
        action === "review"
          ? side === "contract"
            ? "合同事实和历史结算更正仅合同部主管可以复核"
            : "历史实付和余额更正仅财务主管可以复核"
          : side === "contract"
            ? "当前岗位不能提交合同侧历史更正"
            : "当前岗位不能提交财务侧历史更正"
      );
    }
  }

  private sideForScope(
    scope: ContractTakeoverCorrectionScope
  ): "contract" | "finance" {
    if (CONTRACT_SCOPES.has(scope)) return "contract";
    if (FINANCE_SCOPES.has(scope)) return "finance";
    throw new BadRequestException("历史更正范围不正确");
  }

  private parseScope(
    value: string | null
  ): ContractTakeoverCorrectionScope {
    if (
      value === "historical_settlement" ||
      value === "historical_payment" ||
      value === "historical_advance" ||
      value === "abnormal_overpay"
    ) {
      return value;
    }
    throw new BadRequestException(
      "历史更正记录的业务范围无效"
    );
  }

  private parseBalanceType(value: unknown): BalanceType {
    if (
      value === "historical_advance" ||
      value === "abnormal_overpay"
    ) {
      return value;
    }
    throw new BadRequestException(
      "该更正动作必须指向历史余额"
    );
  }

  private rethrowTransactionError(error: unknown): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ForbiddenException
    ) {
      throw error;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictException(
        "更正应用幂等键或目标记录已被占用"
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (
        error.code === "P2034" ||
        (error.code === "P2010" &&
          String(error.meta?.code ?? "") === "40001")
      )
    ) {
      throw new ConflictException(
        "历史更正与其他业务并发冲突，请刷新后重试"
      );
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "40001"
    ) {
      throw new ConflictException(
        "历史更正与其他业务并发冲突，请刷新后重试"
      );
    }
    throw error;
  }
}

type StoredOperatingImpact = {
  sourceImpactKey: string;
  impactKind: string;
  amountCents: bigint;
  direction: string;
  subjectRole: string | null;
  subjectKind: string | null;
  subjectId: string | null;
  costCategoryCode: string | null;
  fundPurpose: string | null;
  description: string | null;
  impactSnapshot: Prisma.JsonValue;
};

type StoredOperatingFact = {
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  sourceBusinessCode: string;
  occurredAt: Date;
  confirmedAt: Date;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  affiliateCreditCodeSnapshot: string | null;
  operatingLedgerEffectiveDateSnapshot: Date;
  isBeforeOperatingLedgerEffectiveDate: boolean;
  historicalTakeoverBatchId: string | null;
  factKind: string;
  operatingLevel: string;
  evidenceLevel: string;
  amountCents: bigint;
  currencyCode: string;
  direction: string;
  debtorSubjectKind: string | null;
  debtorSubjectId: string | null;
  creditorSubjectKind: string | null;
  creditorSubjectId: string | null;
  approvedPayerSubjectKind: string | null;
  approvedPayerSubjectId: string | null;
  actualPayerSubjectKind: string | null;
  actualPayerSubjectId: string | null;
  payeeSubjectKind: string | null;
  payeeSubjectId: string | null;
  costBearingCompanySubjectKind: string | null;
  costBearingCompanySubjectId: string | null;
  impacts: StoredOperatingImpact[];
};

function operatingSubjects(fact: StoredOperatingFact) {
  return {
    ...(fact.debtorSubjectKind && fact.debtorSubjectId
      ? { debtor: { kind: fact.debtorSubjectKind, id: fact.debtorSubjectId } }
      : {}),
    ...(fact.creditorSubjectKind && fact.creditorSubjectId
      ? { creditor: { kind: fact.creditorSubjectKind, id: fact.creditorSubjectId } }
      : {}),
    ...(fact.approvedPayerSubjectKind && fact.approvedPayerSubjectId
      ? {
          approvedPayer: {
            kind: fact.approvedPayerSubjectKind,
            id: fact.approvedPayerSubjectId
          }
        }
      : {}),
    ...(fact.actualPayerSubjectKind && fact.actualPayerSubjectId
      ? {
          actualPayer: {
            kind: fact.actualPayerSubjectKind,
            id: fact.actualPayerSubjectId
          }
        }
      : {}),
    ...(fact.payeeSubjectKind && fact.payeeSubjectId
      ? { payee: { kind: fact.payeeSubjectKind, id: fact.payeeSubjectId } }
      : {}),
    ...(fact.costBearingCompanySubjectKind && fact.costBearingCompanySubjectId
      ? {
          costBearingCompany: {
            kind: fact.costBearingCompanySubjectKind,
            id: fact.costBearingCompanySubjectId
          }
        }
      : {})
  } as AppendOperatingFactInput["subjects"];
}

function correctionDelta(value: Prisma.JsonValue | null): bigint {
  return jsonMoney(value, "amountCents", "历史更正差额");
}

function operatingCorrectionImpacts(
  originalImpacts: readonly StoredOperatingImpact[],
  scope: ContractTakeoverCorrectionScope,
  allocationType: string | null,
  delta: bigint,
  reclassification: Prisma.JsonObject | null
): OperatingImpactInput[] {
  if (scope === "historical_settlement") {
    return originalImpacts
      .filter((impact) => impact.impactKind !== "invoice_reference")
      .map((impact) => signedImpact(impact, delta));
  }

  const funds = originalImpacts.find((impact) =>
    impact.sourceImpactKey.endsWith("_funds_decrease")
  );
  const balance = originalImpacts.find((impact) =>
    ["historical_advance", "abnormal_overpay"].includes(impact.sourceImpactKey)
  );
  const payable = originalImpacts.find((impact) =>
    impact.sourceImpactKey.startsWith("payable:")
  );
    if (reclassification && balance) {
    const from = typeof reclassification.from === "string" ? reclassification.from : null;
    const to = typeof reclassification.to === "string" ? reclassification.to : null;
    if (!from || !to) throw new BadRequestException("历史重分类缺少来源或目标余额");
    const amountCents = jsonMoney(
      reclassification,
      "amountCents",
      "历史重分类差额"
    );
    return [
      signedImpact(
        {
          ...balance,
          sourceImpactKey: `reclassification:${from}`,
          impactKind: inverseImpactKind(balance.impactKind)
        },
        amountCents
      ),
      {
        ...signedImpact(
          balance,
          amountCents
        ),
        sourceImpactKey: `reclassification:${to}`,
        impactKind: balanceImpactKind(
          to,
          balance.impactKind
        ) as OperatingImpactInput["impactKind"]
      }
    ];
  }

  const impacts: OperatingImpactInput[] = [];
  if (funds) impacts.push(signedImpact(funds, delta));
  if (allocationType === "settlement" && payable) {
    impacts.push(signedImpact(payable, delta));
  } else if (balance && allocationType) {
    impacts.push(signedImpact(balance, delta));
  }
  return impacts;
}

function signedImpact(impact: StoredOperatingImpact, delta: bigint): OperatingImpactInput {
  const positive = delta >= 0n;
  const amountCents = absBigInt(delta);
  const impactKind = positive ? impact.impactKind : inverseImpactKind(impact.impactKind);
  return {
    idempotencyKey: `correction:${impact.sourceImpactKey}:${positive ? "increase" : "decrease"}`,
    sourceImpactKey: `correction:${impact.sourceImpactKey}`,
    impactKind: impactKind as OperatingImpactInput["impactKind"],
    amountCents,
    direction: positive ? "increase" : "decrease",
    ...(impact.subjectRole && impact.subjectKind && impact.subjectId
      ? {
          subjectRole: impact.subjectRole as OperatingImpactInput["subjectRole"],
          subject: {
            kind: impact.subjectKind as OperatingSubjectReference["kind"],
            id: impact.subjectId
          }
        }
      : {}),
    ...(impact.costCategoryCode
      ? { costCategoryCode: impact.costCategoryCode as OperatingImpactInput["costCategoryCode"] }
      : {}),
    ...(impact.fundPurpose ? { fundPurpose: impact.fundPurpose } : {}),
    description: `历史更正：${impact.description ?? impact.sourceImpactKey}`,
    impactSnapshot:
      impact.impactSnapshot && typeof impact.impactSnapshot === "object" && !Array.isArray(impact.impactSnapshot)
        ? (impact.impactSnapshot as Prisma.InputJsonObject)
        : {}
  };
}

function inverseImpactKind(kind: string): string {
  if (kind.endsWith("_increase")) return `${kind.slice(0, -9)}_decrease`;
  if (kind.endsWith("_decrease")) return `${kind.slice(0, -9)}_increase`;
  return kind;
}

function balanceImpactKind(balanceType: string, originalKind: string): string {
  if (balanceType === "historical_advance") {
    return originalKind.includes("company_advance")
      ? "company_advance_for_project_increase"
      : "inter_subject_balance_increase";
  }
  return originalKind.includes("company_returnable")
    ? "company_returnable_to_project_increase"
    : "inter_subject_balance_increase";
}

function correctionDirection(direction: string, delta: bigint): AppendOperatingFactInput["direction"] {
  if (delta >= 0n) return direction as AppendOperatingFactInput["direction"];
  if (direction === "outflow") return "inflow";
  if (direction === "inflow") return "outflow";
  return "neutral";
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function required(value: string | null | undefined, message: string) {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function parseNonZeroDelta(value: string | undefined) {
  const normalized = required(value, "请填写非零更正差额");
  if (!/^(?:[1-9]\d*|-[1-9]\d*)$/u.test(normalized)) {
    throw new BadRequestException(
      "更正差额必须按分填写为非零整数"
    );
  }
  const amount = BigInt(normalized);
  if (!isWithinPostgresBigIntRange(amount)) {
    throw new BadRequestException(
      "更正差额超出系统可保存范围"
    );
  }
  return amount;
}

function parsePositiveDelta(value: string | undefined) {
  const amount = parseNonZeroDelta(value);
  if (amount <= 0n) {
    throw new BadRequestException(
      "重分类金额必须大于 0"
    );
  }
  return amount;
}

function checkedAdd(left: bigint, right: bigint, label: string) {
  const result = left + right;
  if (!isWithinPostgresBigIntRange(result)) {
    throw new BadRequestException(
      `${label}超出系统可保存范围`
    );
  }
  return result;
}

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function asObject(
  value: Prisma.JsonValue | null,
  label: string
): Prisma.JsonObject {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new BadRequestException(`${label}结构无效`);
  }
  return value;
}

function jsonMoney(
  value: Prisma.JsonValue | null,
  key: string,
  label: string
) {
  const object = asObject(value, label);
  const raw = object[key];
  if (
    typeof raw !== "string" ||
    !/^-?(?:0|[1-9]\d*)$/u.test(raw)
  ) {
    throw new BadRequestException(`${label}结构无效`);
  }
  const amount = BigInt(raw);
  if (!isWithinPostgresBigIntRange(amount)) {
    throw new BadRequestException(
      `${label}超出系统可保存范围`
    );
  }
  return amount;
}

function frozenMoney(
  beforeCents: bigint,
  deltaCents: bigint,
  afterCents: bigint,
  metadata: Snapshot
) {
  return {
    beforeSnapshot: {
      amountCents: beforeCents.toString(),
      balanceCents: beforeCents.toString(),
      ...metadata
    },
    deltaSnapshot: {
      amountCents: deltaCents.toString()
    },
    afterSnapshot: {
      amountCents: afterCents.toString(),
      balanceCents: afterCents.toString()
    },
    targetHistoricalPaymentId: null,
    targetAllocationId: null,
    targetBalanceEntryId: null
  };
}

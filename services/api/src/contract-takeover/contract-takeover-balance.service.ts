import {
  BadRequestException,
  ConflictException,
  Injectable
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { dbMoneyToBigInt } from "../money/decimal-money";

interface LockedAdvanceAccount {
  id: string;
  openingCents: bigint;
  balanceCents: bigint;
  revision: number;
}

interface LockedBalanceEntry {
  entryId: string;
  accountId: string;
  entryKind: string;
  amountCents: bigint;
  balanceCents: bigint;
  revision: number;
  settlementId: string;
  settlementPayableAmountCents: bigint;
}

interface LockedAbnormalAccount {
  id: string;
  takeoverId: string;
  balanceCents: bigint;
}

@Injectable()
export class ContractTakeoverBalanceService {
  constructor(private readonly audit: AuditService) {}

  async deductAdvanceForSettlement(
    tx: Prisma.TransactionClient,
    settlement: {
      id: string;
      contractVersionId: string;
      payableAmountCents: bigint;
    },
    actorUserId: string
  ) {
    const [account] = await tx.$queryRaw<LockedAdvanceAccount[]>(
      Prisma.sql`
        SELECT
          account."id",
          account."openingCents",
          account."balanceCents",
          account."revision"
        FROM "ContractTakeoverBalanceAccount" account
        JOIN "ContractTakeover" takeover
          ON takeover."id" = account."takeoverId"
        WHERE takeover."contractVersionId" =
              ${settlement.contractVersionId}
          AND takeover."activatedAt" IS NOT NULL
          AND account."balanceType" = 'historical_advance'
        ORDER BY account."id"
        FOR UPDATE OF account
      `
    );
    if (!account) return null;

    const idempotencyKey =
      `settlement:${settlement.id}:historical-advance-deduction`;
    const existing =
      await tx.contractTakeoverBalanceEntry.findUnique({
        where: { idempotencyKey },
        select: {
          id: true,
          accountId: true,
          amountCents: true
        }
      });
    if (existing) {
      if (existing.accountId !== account.id) {
        throw new ConflictException(
          "结算预付款抵扣幂等记录与当前余额账户不一致"
        );
      }
      const deductionCents = dbMoneyToBigInt(
        existing.amountCents,
        "历史预付款抵扣金额"
      );
      const balanceAfterCents = dbMoneyToBigInt(
        account.balanceCents,
        "历史预付款当前余额"
      );
      return {
        accountId: account.id,
        entryId: existing.id,
        openingCents: dbMoneyToBigInt(
          account.openingCents,
          "历史预付款期初余额"
        ),
        balanceBeforeCents:
          balanceAfterCents + deductionCents,
        deductionCents,
        balanceAfterCents,
        payableAfterDeductionCents: dbMoneyToBigInt(
          settlement.payableAmountCents,
          "抵扣后结算可付金额"
        ),
        repeated: true
      };
    }

    const payableAmountCents = dbMoneyToBigInt(
      settlement.payableAmountCents,
      "结算本期应付金额"
    );
    const balanceBeforeCents = dbMoneyToBigInt(
      account.balanceCents,
      "历史预付款当前余额"
    );
    const deductionCents =
      payableAmountCents < balanceBeforeCents
        ? payableAmountCents
        : balanceBeforeCents;
    if (deductionCents <= 0n) return null;
    const balanceAfterCents =
      balanceBeforeCents - deductionCents;

    const entry =
      await tx.contractTakeoverBalanceEntry.create({
        data: {
          accountId: account.id,
          entryKind: "deduction",
          amountCents: deductionCents,
          settlementId: settlement.id,
          idempotencyKey,
          createdByUserId: actorUserId
        },
        select: { id: true, amountCents: true }
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
        "历史预付款余额并发变化，抵扣已中止"
      );
    }
    const settlementUpdated = await tx.settlement.updateMany({
      where: {
        id: settlement.id,
        payableAmountCents
      },
      data: {
        payableAmountCents: this.remainingPayable(
          payableAmountCents,
          deductionCents
        )
      }
    });
    if (settlementUpdated.count !== 1) {
      throw new ConflictException(
        "结算可付金额并发变化，历史预付款抵扣已中止"
      );
    }

    await this.audit.record(tx, {
      actorUserId,
      action: "contract_takeover.balance.deduct",
      businessType: "settlement",
      businessId: settlement.id,
      metadata: {
        accountId: account.id,
        entryId: entry.id,
        balanceBeforeCents: balanceBeforeCents.toString(),
        deductionCents: deductionCents.toString(),
        balanceAfterCents: balanceAfterCents.toString()
      }
    });

    return {
      accountId: account.id,
      entryId: entry.id,
      openingCents: dbMoneyToBigInt(
        account.openingCents,
        "历史预付款期初余额"
      ),
      balanceBeforeCents,
      deductionCents,
      balanceAfterCents,
      payableAfterDeductionCents: this.remainingPayable(
        payableAmountCents,
        deductionCents
      ),
      repeated: false
    };
  }

  async reverseEntryInTransaction(
    tx: Prisma.TransactionClient,
    entryId: string,
    actorUserId: string,
    idempotencyKey: string
  ) {
    const [original] = await tx.$queryRaw<LockedBalanceEntry[]>(
      Prisma.sql`
        SELECT
          entry."id" AS "entryId",
          entry."accountId",
          entry."entryKind",
          entry."amountCents",
          account."balanceCents",
          account."revision",
          settlement."id" AS "settlementId",
          settlement."payableAmountCents"
            AS "settlementPayableAmountCents"
        FROM "ContractTakeoverBalanceEntry" entry
        JOIN "ContractTakeoverBalanceAccount" account
          ON account."id" = entry."accountId"
        JOIN "Settlement" settlement
          ON settlement."id" = entry."settlementId"
        WHERE entry."id" = ${entryId}
          AND entry."entryKind" = 'deduction'
        FOR UPDATE OF account, entry, settlement
      `
    );
    if (!original) {
      throw new BadRequestException("未找到要反向的余额流水");
    }
    const existing =
      await tx.contractTakeoverBalanceEntry.findUnique({
        where: { reversesEntryId: entryId },
        select: {
          id: true,
          accountId: true,
          amountCents: true
        }
      });
    if (existing) {
      if (
        existing.accountId !== original.accountId ||
        existing.amountCents !== original.amountCents
      ) {
        throw new ConflictException(
          "余额反向记录与原流水不一致"
        );
      }
      return {
        accountId: original.accountId,
        entryId: existing.id,
        reversesEntryId: entryId,
        reversedAmountCents: dbMoneyToBigInt(
          existing.amountCents,
          "余额反向金额"
        ),
        balanceBeforeCents:
          dbMoneyToBigInt(original.balanceCents, "余额当前值") -
          dbMoneyToBigInt(existing.amountCents, "余额反向金额"),
        balanceAfterCents: dbMoneyToBigInt(
          original.balanceCents,
          "余额当前值"
        ),
        repeated: true
      };
    }

    const reversedAmountCents = dbMoneyToBigInt(
      original.amountCents,
      "余额反向金额"
    );
    const balanceBeforeCents = dbMoneyToBigInt(
      original.balanceCents,
      "余额当前值"
    );
    const balanceAfterCents =
      balanceBeforeCents + reversedAmountCents;
    const reversal =
      await tx.contractTakeoverBalanceEntry.create({
        data: {
          accountId: original.accountId,
          entryKind: "reversal",
          amountCents: reversedAmountCents,
          reversesEntryId: entryId,
          idempotencyKey,
          createdByUserId: actorUserId
        },
        select: { id: true, amountCents: true }
      });
    const updated =
      await tx.contractTakeoverBalanceAccount.updateMany({
        where: {
          id: original.accountId,
          revision: original.revision,
          balanceCents: original.balanceCents
        },
        data: {
          balanceCents: balanceAfterCents,
          revision: { increment: 1 }
        }
      });
    if (updated.count !== 1) {
      throw new ConflictException(
        "余额并发变化，反向已中止"
      );
    }
    const settlementPayableAmountCents = dbMoneyToBigInt(
      original.settlementPayableAmountCents,
      "抵扣后结算可付金额"
    );
    const settlementUpdated = await tx.settlement.updateMany({
      where: {
        id: original.settlementId,
        payableAmountCents: original.settlementPayableAmountCents
      },
      data: {
        payableAmountCents:
          settlementPayableAmountCents + reversedAmountCents
      }
    });
    if (settlementUpdated.count !== 1) {
      throw new ConflictException(
        "结算可付金额并发变化，余额反向已中止"
      );
    }

    await this.audit.record(tx, {
      actorUserId,
      action: "contract_takeover.balance.reverse",
      businessType: "contract_takeover_balance_entry",
      businessId: entryId,
      metadata: {
        accountId: original.accountId,
        reversalEntryId: reversal.id,
        reversedAmountCents: reversedAmountCents.toString(),
        balanceBeforeCents: balanceBeforeCents.toString(),
        balanceAfterCents: balanceAfterCents.toString()
      }
    });

    return {
      accountId: original.accountId,
      entryId: reversal.id,
      reversesEntryId: entryId,
      reversedAmountCents,
      balanceBeforeCents,
      balanceAfterCents,
      repeated: false
    };
  }

  async assertNoAbnormalOverpayForContract(
    tx: Prisma.TransactionClient,
    contractId: string,
    actionLabel: string
  ): Promise<void> {
    const accounts = await tx.$queryRaw<LockedAbnormalAccount[]>(
      Prisma.sql`
        SELECT
          account."id",
          account."takeoverId",
          account."balanceCents"
        FROM "ContractTakeoverBalanceAccount" account
        JOIN "ContractTakeover" takeover
          ON takeover."id" = account."takeoverId"
        WHERE takeover."contractId" = ${contractId}
          AND takeover."activatedAt" IS NOT NULL
          AND account."balanceType" = 'abnormal_overpay'
        ORDER BY takeover."id", account."id"
        FOR UPDATE OF account
      `
    );
    if (
      accounts.some(
        (account) =>
          dbMoneyToBigInt(
            account.balanceCents,
            "异常超付当前余额"
          ) > 0n
      )
    ) {
      throw new BadRequestException(
        `历史接管存在尚未解除的异常超付，不能${actionLabel}`
      );
    }
  }

  private remainingPayable(
    payableAmountCents: bigint,
    deductionCents: bigint
  ): bigint {
    const remaining = payableAmountCents - deductionCents;
    return remaining > 0n ? remaining : 0n;
  }
}

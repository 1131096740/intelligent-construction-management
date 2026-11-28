import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { contractProxyPaidForContract } from "../contract-ledger/contract-proxy-capacity";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  historicalAdvancePaymentBasis,
  toHistoricalContractPaymentBalance,
  type ContractTakeoverBalanceRow
} from "./contract-takeover-balance";
import {
  CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES,
  SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
  sumMoneyCents
} from "./settlement-payment-capacity";

const decimal = Prisma.Decimal.clone({ precision: 50 });

/** 付款写路径只登记下游合同；表外/对上结算不产生我方付款申请。 */
export const SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND = "downstream";

export interface ConfirmedSignedSettlementRow {
  id: string;
  number: string | null;
  amountYuan: Prisma.Decimal | string | null;
  confirmationNo: bigint | null;
  reviewedAt: Date | null;
}

export interface SignedSettlementCapacityFacts {
  /** 合同支付口径累计结算（已签 + 旧结算 + 历史起点），整数分。 */
  confirmedCents: bigint;
  /** 已登记实付（含预付款实付与历史已付），整数分。 */
  paidCents: bigint;
  /** paidCents 中属于合同预付款的部分，用于区分未结算预付与异常超付。 */
  advancePaidCents: bigint;
  /** 审批中、批准待付、部分剩余的未付占用，整数分。 */
  outstandingCents: bigint;
  proxyPaidCents: bigint;
  historicalOutstandingCents: bigint;
}

export interface SignedSettlementPaymentCapacity {
  confirmedCents: bigint;
  netPaidCents: bigint;
  occupiedCents: bigint;
  outstandingCents: bigint;
  advancePaidCents: bigint;
  unsettledAdvanceCents: bigint;
  overpayCents: bigint;
  abnormalOverpayCents: bigint;
  capacityShortfallCents: bigint;
  /** 可为负：实付/审批校验需还原当前申请自身在途后再判断。 */
  rawRemainingCents: bigint;
  remainingCents: bigint;
  /** 合同全部未付占用合计超过可付余额时暂停，后续新结算使余额足够自动解除。 */
  suspended: boolean;
}

export interface SignedSettlementPaymentBasis extends SignedSettlementPaymentCapacity {
  latestConfirmed: ConfirmedSignedSettlementRow & { amountYuan: Prisma.Decimal };
  confirmedContractYuan: Prisma.Decimal;
  signedConfirmedYuan: Prisma.Decimal;
  legacyConfirmedCents: bigint;
  historicalConfirmedCents: bigint;
}

/** 累计结算按支付口口径先精确汇总到四位，再半入到分；负数按绝对值半入后恢复符号。 */
export function settlementAmountYuanToCents(value: Prisma.Decimal): bigint {
  const negative = value.isNegative();
  const absolute = value.abs().times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const cents = BigInt(absolute.toFixed(0));
  return negative ? -cents : cents;
}

/**
 * 合同已签结算容量的纯计算：累计结算 - 有效净已付（含预付款、代付）- 全部未付占用。
 * 超付先按预付未结算部分解释，剩余才计异常超付；两者都不改写真实付款事实。
 */
export function calculateSignedSettlementPaymentCapacity(
  facts: SignedSettlementCapacityFacts
): SignedSettlementPaymentCapacity {
  const advancePaidCents = facts.advancePaidCents > facts.paidCents ? facts.paidCents : facts.advancePaidCents;
  const netPaidCents = facts.paidCents + facts.proxyPaidCents;
  const occupiedCents =
    netPaidCents + facts.outstandingCents + facts.historicalOutstandingCents;
  const overpayCents = netPaidCents > facts.confirmedCents ? netPaidCents - facts.confirmedCents : 0n;
  const advanceExcessCents =
    advancePaidCents > facts.confirmedCents ? advancePaidCents - facts.confirmedCents : 0n;
  const unsettledAdvanceCents = advanceExcessCents < overpayCents ? advanceExcessCents : overpayCents;
  const abnormalOverpayCents = overpayCents - unsettledAdvanceCents;
  const rawRemainingCents = facts.confirmedCents - occupiedCents;
  const capacityShortfallCents = rawRemainingCents < 0n ? -rawRemainingCents : 0n;

  return {
    confirmedCents: facts.confirmedCents,
    netPaidCents,
    occupiedCents,
    outstandingCents: facts.outstandingCents,
    advancePaidCents,
    unsettledAdvanceCents,
    overpayCents,
    abnormalOverpayCents,
    capacityShortfallCents,
    rawRemainingCents,
    remainingCents: rawRemainingCents > 0n ? rawRemainingCents : 0n,
    suspended: rawRemainingCents < 0n
  };
}

function amountYuan(value: Prisma.Decimal | string | null | undefined): Prisma.Decimal {
  return new decimal(value === null || value === undefined ? 0 : value.toString());
}

/** 确认序号定义“最近一期”；同毫秒时以复核时间与 id 稳定排序。 */
export function orderConfirmedSignedSettlements<
  T extends { confirmationNo: bigint | null; reviewedAt: Date | null; id: string }
>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    if (
      left.confirmationNo !== null &&
      right.confirmationNo !== null &&
      left.confirmationNo !== right.confirmationNo
    ) {
      return left.confirmationNo > right.confirmationNo ? -1 : 1;
    }
    if (left.confirmationNo === null && right.confirmationNo !== null) return 1;
    if (left.confirmationNo !== null && right.confirmationNo === null) return -1;
    const leftReviewedAt = left.reviewedAt?.valueOf() ?? 0;
    const rightReviewedAt = right.reviewedAt?.valueOf() ?? 0;
    if (leftReviewedAt !== rightReviewedAt) return rightReviewedAt - leftReviewedAt;
    return right.id.localeCompare(left.id);
  });
}

export function paymentRequestOutstandingCents(payment: {
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents: bigint | null;
  paidAmountCents: bigint;
  remainingWithdrawnCents?: bigint | null;
}): bigint {
  if (payment.remainingWithdrawnCents != null) return 0n;
  const payableAmountCents = ["approved_pending_payment", "partially_paid", "paid"].includes(
    payment.status
  )
    ? (payment.approvedAmountCents ?? payment.requestedAmountCents)
    : payment.requestedAmountCents;
  const outstanding = payableAmountCents - payment.paidAmountCents;
  return outstanding > 0n ? outstanding : 0n;
}

/**
 * 读取合同级已签结算付款容量：合同累计结算（含负数、旧结算、历史起点）
 * 减去已登记付款、在途申请、代付与历史占用。调用方需在同一事务内使用
 * lock=true，与已签结算提交/复核共享同一条合同级 advisory lock。
 */
export async function loadSignedSettlementPaymentBasis(
  tx: Prisma.TransactionClient,
  contractId: string,
  options: { lock?: boolean } = {}
): Promise<SignedSettlementPaymentBasis> {
  if (options.lock) {
    const lockSql = Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('signed-settlement:' || ${SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND} || ':' || ${contractId}, 0))`;
    const executeRaw = (tx as unknown as {
      $executeRaw?: (query: Prisma.Sql) => Promise<unknown>;
    }).$executeRaw;
    // `pg_advisory_xact_lock` returns void, which Prisma cannot deserialize from
    // $queryRaw on a real database; tests use $queryRaw doubles, production uses execute.
    if (typeof executeRaw === "function") {
      await executeRaw.call(tx, lockSql);
    } else {
      await tx.$queryRaw(lockSql);
    }
  }

  const signedRows = await tx.signedContractSettlement.findMany({
    where: {
      contractKind: SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND,
      contractId,
      state: "confirmed"
    },
    select: {
      id: true,
      number: true,
      amountYuan: true,
      confirmationNo: true,
      reviewedAt: true
    }
  });
  const missingConfirmation = signedRows.find(
    (row) =>
      row.number === null ||
      row.amountYuan === null ||
      row.confirmationNo === null ||
      row.reviewedAt === null
  );
  if (missingConfirmation) {
    throw new ConflictException("已确认结算的编号、金额或确认顺序待核对");
  }

  const [legacyRows, takeover, requests, proxyRows, proxyBySource] = await Promise.all([
    tx.settlement.findMany({
      where: {
        contractId,
        status: { in: [...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES] }
      },
      select: { amountCents: true, sourceType: true, sourceTakeoverId: true }
    }),
    tx.contractTakeover.findFirst({
      where: {
        contractId,
        takeoverStatus: "confirmed",
        historicalBalanceConfirmedAt: { not: null }
      },
      select: { ...CONTRACT_TAKEOVER_BALANCE_SELECT, takeoverLevel: true }
    }),
    tx.paymentRequest.findMany({
      where: {
        contractId,
        sourceType: { in: ["settlement", "contract_due", "signed_settlement", "contract_advance"] },
        status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES, "paid"] }
      },
      select: {
        sourceType: true,
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true,
        remainingWithdrawnCents: true
      }
    }),
    tx.projectProxyPayment.findMany({
      where: { voidedAt: null, contractId },
      select: { amountCents: true }
    }),
    contractProxyPaidForContract(tx, contractId)
  ]);

  const historicalBalance = toHistoricalContractPaymentBalance(
    takeover as ContractTakeoverBalanceRow | null
  );
  const legacyConfirmedCents = sumMoneyCents(
    legacyRows
      .filter((row) => row.sourceType !== "historical_takeover" && row.sourceTakeoverId === null)
      .map((row) => row.amountCents)
  );
  const historicalConfirmedCents = historicalBalance?.settledCents ?? 0n;
  const historicalPaidCents = historicalBalance?.paidCents ?? 0n;
  const historicalProxyPaidCents = historicalBalance?.proxyPaidCents ?? 0n;
  const historicalAdvance = historicalAdvancePaymentBasis(historicalBalance ? takeover : null);
  const withheldCents =
    (historicalBalance?.retentionWithheldCents ?? 0n) -
    (historicalBalance?.retentionReleasedCents ?? 0n);
  const historicalOutstandingCents =
    (historicalBalance?.approvalPendingPaymentCents ?? 0n) +
    (historicalBalance?.approvedPendingPaymentCents ?? 0n) +
    (withheldCents > 0n ? withheldCents : 0n) +
    (historicalBalance?.otherConfirmedOccupancyCents ?? 0n);

  const signedConfirmedYuan = signedRows.reduce(
    (total, row) => total.plus(amountYuan(row.amountYuan)),
    new decimal(0)
  );
  const confirmedContractYuan = signedConfirmedYuan
    .plus(new decimal(legacyConfirmedCents.toString()).div(100))
    .plus(new decimal(historicalConfirmedCents.toString()).div(100));
  const outstandingCents = requests.reduce(
    (total, request) => total + paymentRequestOutstandingCents(request),
    0n
  );
  const proxyPaidCents =
    sumMoneyCents(proxyRows.map((row) => row.amountCents)) +
    proxyBySource +
    historicalProxyPaidCents;
  const recordedPaidCents =
    requests.reduce((total, request) => total + request.paidAmountCents, 0n) +
    historicalPaidCents +
    historicalAdvance.advanceOutsidePaidTotalCents;
  const systemAdvancePaidCents = requests.reduce(
    (total, request) =>
      request.sourceType === "contract_advance" ? total + request.paidAmountCents : total,
    0n
  );
  const capacity = calculateSignedSettlementPaymentCapacity({
    confirmedCents: settlementAmountYuanToCents(confirmedContractYuan),
    paidCents: recordedPaidCents,
    advancePaidCents: systemAdvancePaidCents + historicalAdvance.netAdvanceCents,
    outstandingCents,
    proxyPaidCents,
    historicalOutstandingCents
  });

  const [latestConfirmed] = orderConfirmedSignedSettlements(signedRows);
  if (!latestConfirmed) {
    throw new ConflictException("该合同暂无可付款的已签结算，请先完成主管复核");
  }
  return {
    ...capacity,
    latestConfirmed: { ...latestConfirmed, amountYuan: amountYuan(latestConfirmed.amountYuan) },
    confirmedContractYuan,
    signedConfirmedYuan,
    legacyConfirmedCents,
    historicalConfirmedCents
  };
}

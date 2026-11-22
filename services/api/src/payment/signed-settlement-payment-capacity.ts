import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { contractProxyPaidForContract } from "../contract-ledger/contract-proxy-capacity";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
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

export interface SignedSettlementPaymentBasis {
  latestConfirmed: ConfirmedSignedSettlementRow & { amountYuan: Prisma.Decimal };
  confirmedContractYuan: Prisma.Decimal;
  signedConfirmedYuan: Prisma.Decimal;
  legacyConfirmedCents: bigint;
  historicalConfirmedCents: bigint;
  occupiedCents: bigint;
  outstandingCents: bigint;
  proxyPaidCents: bigint;
  historicalOutstandingCents: bigint;
  /** 可为负：实付校验需还原当前申请自身在途后再判断。 */
  rawRemainingCents: bigint;
  remainingCents: bigint;
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
}): bigint {
  const payableAmountCents = ["approved_pending_payment", "partially_paid", "paid"].includes(
    payment.status
  )
    ? (payment.approvedAmountCents ?? payment.requestedAmountCents)
    : payment.requestedAmountCents;
  const outstanding = payableAmountCents - payment.paidAmountCents;
  return outstanding > 0n ? outstanding : 0n;
}

function yuanToWholeCentsFloor(value: Prisma.Decimal): bigint {
  return BigInt(value.times(100).floor().toFixed(0));
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
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('signed-settlement:' || ${SIGNED_SETTLEMENT_PAYMENT_CONTRACT_KIND} || ':' || ${contractId}, 0))`
    );
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
      select: CONTRACT_TAKEOVER_BALANCE_SELECT
    }),
    tx.paymentRequest.findMany({
      where: {
        contractId,
        sourceType: { in: ["settlement", "contract_due", "signed_settlement"] },
        status: { in: [...SETTLEMENT_CAPACITY_PAYMENT_STATUSES, "paid"] }
      },
      select: {
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
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
    historicalPaidCents;
  const occupiedCents =
    recordedPaidCents +
    outstandingCents +
    proxyPaidCents +
    historicalOutstandingCents;
  const rawRemainingCents = yuanToWholeCentsFloor(confirmedContractYuan) - occupiedCents;

  const [latestConfirmed] = orderConfirmedSignedSettlements(signedRows);
  if (!latestConfirmed) {
    throw new ConflictException("该合同暂无可付款的已签结算，请先完成主管复核");
  }
  return {
    latestConfirmed: { ...latestConfirmed, amountYuan: amountYuan(latestConfirmed.amountYuan) },
    confirmedContractYuan,
    signedConfirmedYuan,
    legacyConfirmedCents,
    historicalConfirmedCents,
    occupiedCents,
    outstandingCents,
    proxyPaidCents,
    historicalOutstandingCents,
    rawRemainingCents,
    remainingCents: rawRemainingCents > 0n ? rawRemainingCents : 0n
  };
}

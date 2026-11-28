import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { contractProxyPaidForContract } from "../contract-ledger/contract-proxy-capacity";
import { historicalAdvancePaymentBasis } from "../payment/contract-takeover-balance";
import { loadSettlementPaymentConfirmationFacts } from "../payment/settlement-confirmation-facts";
import { calculateSettlementPaymentCapacityBigInt, CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES, type SettlementCapacityPaymentRequest } from "../payment/settlement-payment-capacity";
import { calculateSignedSettlementPaymentCapacity, settlementAmountYuanToCents } from "../payment/signed-settlement-payment-capacity";

const decimal = Prisma.Decimal.clone({ precision: 50 });

export interface ConfirmedPaymentSettlement {
  id: string;
  number: string;
  amountYuan: string;
  confirmedAt: Date;
  confirmationNo: string | null;
  source: "signed_registration" | "legacy";
  attachmentFileIds: string[];
}

export function orderConfirmedPaymentSettlements(rows: ConfirmedPaymentSettlement[]) {
  return [...rows].sort((left, right) => {
    const dateOrder = right.confirmedAt.valueOf() - left.confirmedAt.valueOf();
    if (dateOrder) return dateOrder;
    if (left.confirmationNo !== null && right.confirmationNo !== null) {
      const l = BigInt(left.confirmationNo);
      const r = BigInt(right.confirmationNo);
      if (l !== r) return l > r ? -1 : 1;
    }
    if (left.source !== right.source) return left.source === "signed_registration" ? -1 : 1;
    return right.id.localeCompare(left.id);
  });
}

export function signedSettlementPaymentBalance(input: {
  confirmedYuan: string;
  recordedPaidCents: bigint;
  proxyPaidCents: bigint;
  historicalOutstandingCents: bigint;
  requests: readonly SettlementCapacityPaymentRequest[];
  opening?: {
    takeoverLevel?: string | null;
    historicalAdvancePaidCents?: bigint | null;
    historicalAdvanceDeductedCents?: bigint | null;
  } | null;
}) {
  const centsCapacity = calculateSettlementPaymentCapacityBigInt({
    payableAmountCents: 0n,
    actualPaidAmountCents: input.recordedPaidCents,
    proxyPaidAmountCents: input.proxyPaidCents,
    paymentRequests: input.requests
  });
  const historicalAdvance = historicalAdvancePaymentBasis(input.opening);
  const advancePaidCents =
    input.requests.reduce(
      (total, request) =>
        request.sourceType === "contract_advance"
          ? total + request.paidAmountCents
          : total,
      0n
    ) + historicalAdvance.netAdvanceCents;
  const capacity = calculateSignedSettlementPaymentCapacity({
    confirmedCents: settlementAmountYuanToCents(new decimal(input.confirmedYuan)),
    paidCents: input.recordedPaidCents + historicalAdvance.advanceOutsidePaidTotalCents,
    advancePaidCents,
    outstandingCents: centsCapacity.outstandingPaymentCents,
    proxyPaidCents: input.proxyPaidCents,
    historicalOutstandingCents: input.historicalOutstandingCents
  });
  const settledAtPaymentPrecision = capacity.netPaidCents > 0n
    && capacity.netPaidCents === capacity.confirmedCents
    && capacity.rawRemainingCents === 0n;
  const unoccupiedYuan = settledAtPaymentPrecision
    ? "0.0000"
    : new decimal(input.confirmedYuan).minus(new decimal(capacity.occupiedCents.toString()).div(100)).toFixed(4);
  return {
    recordedPaidYuan: new decimal(capacity.netPaidCents.toString()).div(100).toFixed(4),
    outstandingYuan: new decimal((capacity.outstandingCents + input.historicalOutstandingCents).toString()).div(100).toFixed(4),
    unoccupiedYuan,
    wholeCentLimit: capacity.remainingCents.toString(),
    advancePaidYuan: new decimal(capacity.advancePaidCents.toString()).div(100).toFixed(4),
    unsettledAdvanceYuan: new decimal(capacity.unsettledAdvanceCents.toString()).div(100).toFixed(4),
    overpayYuan: new decimal(capacity.overpayCents.toString()).div(100).toFixed(4),
    abnormalOverpayYuan: new decimal(capacity.abnormalOverpayCents.toString()).div(100).toFixed(4),
    capacityShortfallYuan: new decimal(capacity.capacityShortfallCents.toString()).div(100).toFixed(4),
    suspended: capacity.suspended
  };
}

export async function loadDownstreamPaymentBasis(tx: Prisma.TransactionClient, projectId: string, contractId: string, contractVersionId: string, confirmedYuan: string, includeAttachments: boolean) {
  const [legacy, archive, requests, history, terms] = await Promise.all([
    tx.settlement.findMany({ where: { projectId, contractId, status: { in: [...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES] } },
      select: { id: true, code: true, amountCents: true, sourceType: true, sourceTakeoverId: true } }),
    includeAttachments ? tx.contractArchiveFile.findFirst({ where: { contractVersionId, status: "confirmed", confirmedAt: { not: null } },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }], select: { id: true, fileId: true } }) : null,
    tx.paymentRequest.findMany({ where: { projectId, contractId },
      select: { sourceType: true, status: true, requestedAmountCents: true, approvedAmountCents: true, paidAmountCents: true } }),
    tx.contractTakeover.findMany({ where: { projectId, contractId, takeoverStatus: "confirmed", historicalBalanceConfirmedAt: { not: null } }, take: 2,
      select: { takeoverLevel: true, historicalPaidCents: true, historicalProxyPaidCents: true,
        historicalAdvancePaidCents: true, historicalAdvanceDeductedCents: true,
        historicalRetentionWithheldCents: true, historicalRetentionReleasedCents: true, otherConfirmedOccupancyCents: true,
        historicalApprovalPendingPaymentCents: true, historicalApprovedPendingPaymentCents: true } }),
    tx.paymentTermsVersion.findFirst({
      where: { contractId, contractVersionId, status: "effective" },
      orderBy: { versionNo: "desc" },
      select: { originalText: true }
    })
  ]);
  if (history.length > 1) throw new ConflictException("存在多个已确认的历史付款起点，请先核对");
  const ordinary = legacy.filter(row => row.sourceType !== "historical_takeover" && row.sourceTakeoverId === null);
  const ids = ordinary.map(row => row.id);
  const [facts, legacyArchives, signedDocuments, contractEvidence, priorProxy, proxyBySource] = await Promise.all([
    loadSettlementPaymentConfirmationFacts(tx, ids),
    includeAttachments ? tx.settlementArchiveFile.findMany({ where: { settlementId: { in: ids }, status: "confirmed" }, select: { settlementId: true, fileId: true } }) : [],
    includeAttachments ? tx.settlementSignedDocument.findMany({ where: { settlementId: { in: ids }, purpose: "final_internal_signed_copy", status: "active", generationStatus: "completed", confirmedAt: { not: null } },
      select: { settlementId: true, fileId: true } }) : [],
    archive ? tx.contractArchiveEvidenceFile.findMany({ where: { archiveFileId: archive.id, contractVersionId }, orderBy: { displayOrder: "asc" }, select: { fileId: true } }) : [],
    tx.projectProxyPayment.aggregate({ where: { projectId, voidedAt: null, OR: [{ contractId }, { settlementId: { in: legacy.map(row => row.id) } }] }, _sum: { amountCents: true } }),
    contractProxyPaidForContract(tx, contractId)
  ]);
  const filesBySettlement = new Map<string, string[]>();
  for (const file of [...legacyArchives, ...signedDocuments]) {
    if (!file.settlementId) continue;
    const prior = filesBySettlement.get(file.settlementId) ?? [];
    if (!prior.includes(file.fileId)) filesBySettlement.set(file.settlementId, [...prior, file.fileId]);
  }
  const confirmedAt = new Map(facts.map(fact => [fact.settlementId, fact.confirmedAt]));
  const legacyConfirmed: ConfirmedPaymentSettlement[] = ordinary.flatMap(row => {
    const date = confirmedAt.get(row.id);
    return date ? [{ id: row.id, number: row.code, amountYuan: new decimal(row.amountCents.toString()).div(100).toFixed(4),
      confirmedAt: date, confirmationNo: null, source: "legacy", attachmentFileIds: filesBySettlement.get(row.id) ?? [] }] : [];
  });
  const opening = history[0];
  const recordedPaidCents = requests.reduce((sum, row) => sum + row.paidAmountCents, 0n) +
    (opening?.historicalPaidCents ?? 0n);
  const proxyPaidCents = (priorProxy._sum.amountCents ?? 0n) + proxyBySource + (opening?.historicalProxyPaidCents ?? 0n);
  const withheld = (opening?.historicalRetentionWithheldCents ?? 0n) - (opening?.historicalRetentionReleasedCents ?? 0n);
  const historicalOutstandingCents = (opening?.historicalApprovalPendingPaymentCents ?? 0n) +
    (opening?.historicalApprovedPendingPaymentCents ?? 0n) + (withheld > 0n ? withheld : 0n) +
    (opening?.otherConfirmedOccupancyCents ?? 0n);
  return {
    legacyConfirmed,
    contractAttachmentIds: contractEvidence.length ? contractEvidence.map(row => row.fileId) : archive?.fileId ? [archive.fileId] : [],
    paymentAgreementText: terms?.originalText ?? null,
    capacity: signedSettlementPaymentBalance({ confirmedYuan, recordedPaidCents, proxyPaidCents, historicalOutstandingCents, requests, opening })
  };
}

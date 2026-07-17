import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

export interface SpotProcurementClosureSnapshot {
  approved: boolean;
  receiptReviewed: boolean;
  receiptIssuesResolved: boolean;
  actualCostCents: bigint;
  fundsSettledCents: bigint;
  invoiceCoveredCents: bigint;
  noInvoiceCoveredCents: bigint;
  pendingPaymentCount: number;
  pendingCompanyPaymentCount: number;
  pendingBalanceReservationCount: number;
  pendingRefundCount: number;
  pendingBalanceTransferCount: number;
  pendingBalanceExecutionCount: number;
  duplicateTicketCoverageCount: number;
  pendingInvoiceIssueCount: number;
  pendingVersionChangeCount: number;
}

type ClosureBlocker =
  | "version_not_approved"
  | "receipt_not_reviewed"
  | "receipt_issues_unresolved"
  | "funds_not_settled"
  | "tickets_not_covered"
  | "payment_approval_pending"
  | "company_payment_pending"
  | "balance_reservation_pending"
  | "refund_pending"
  | "balance_transfer_pending"
  | "balance_execution_pending"
  | "duplicate_ticket_coverage"
  | "invoice_issue_pending"
  | "version_change_pending";

type ProcurementLockRow = {
  id: string;
  projectId: string;
  currentVersionId: string | null;
  status: string;
  approvedAmountCents: bigint;
  actualCostCents: bigint | null;
};

@Injectable()
export class SpotProcurementClosureService {
  constructor(private readonly audit: AuditService) {}

  static evaluate(snapshot: SpotProcurementClosureSnapshot): {
    canClose: boolean;
    blockers: ClosureBlocker[];
  } {
    const blockers: ClosureBlocker[] = [];
    if (!snapshot.approved) blockers.push("version_not_approved");
    if (!snapshot.receiptReviewed) blockers.push("receipt_not_reviewed");
    if (!snapshot.receiptIssuesResolved) {
      blockers.push("receipt_issues_unresolved");
    }
    if (snapshot.fundsSettledCents !== snapshot.actualCostCents) {
      blockers.push("funds_not_settled");
    }
    if (
      snapshot.invoiceCoveredCents + snapshot.noInvoiceCoveredCents !==
      snapshot.actualCostCents
    ) {
      blockers.push("tickets_not_covered");
    }
    if (snapshot.pendingPaymentCount > 0) {
      blockers.push("payment_approval_pending");
    }
    if (snapshot.pendingCompanyPaymentCount > 0) {
      blockers.push("company_payment_pending");
    }
    if (snapshot.pendingBalanceReservationCount > 0) {
      blockers.push("balance_reservation_pending");
    }
    if (snapshot.pendingRefundCount > 0) blockers.push("refund_pending");
    if (snapshot.pendingBalanceTransferCount > 0) {
      blockers.push("balance_transfer_pending");
    }
    if (snapshot.pendingBalanceExecutionCount > 0) {
      blockers.push("balance_execution_pending");
    }
    if (snapshot.duplicateTicketCoverageCount > 0) {
      blockers.push("duplicate_ticket_coverage");
    }
    if (snapshot.pendingInvoiceIssueCount > 0) {
      blockers.push("invoice_issue_pending");
    }
    if (snapshot.pendingVersionChangeCount > 0) {
      blockers.push("version_change_pending");
    }
    return { canClose: blockers.length === 0, blockers };
  }

  async recalculateAndClose(
    tx: Prisma.TransactionClient,
    procurementId: string,
    trigger: string,
    actorUserId: string
  ): Promise<{
    closed: boolean;
    alreadyClosed: boolean;
    blockers: string[];
    snapshot?: SpotProcurementClosureSnapshot;
  }> {
    const rows = await tx.$queryRaw<ProcurementLockRow[]>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "currentVersionId",
        "status",
        "approvedAmountCents",
        "actualCostCents"
      FROM "SpotProcurement"
      WHERE "id" = ${procurementId}
      FOR UPDATE
    `);
    const procurement = rows[0];
    if (!procurement) throw new NotFoundException("零星采购不存在");
    if (procurement.status === "closed") {
      return { closed: true, alreadyClosed: true, blockers: [] };
    }
    if (procurement.status === "voided") {
      return {
        closed: false,
        alreadyClosed: false,
        blockers: ["procurement_not_open"]
      };
    }

    const version = procurement.currentVersionId
      ? await tx.spotProcurementVersion.findUnique({
          where: { id: procurement.currentVersionId },
          select: {
            id: true,
            procurementId: true,
            status: true,
            totalAmountCents: true
          }
        })
      : null;
    const receipt = await tx.spotProcurementReceipt.findUnique({
      where: { procurementId },
      select: {
        id: true,
        procurementVersionId: true,
        currentRevisionNo: true,
        status: true,
        submittedAt: true,
        actualCostCents: true
      }
    });
    const review = receipt
      ? await tx.spotProcurementReceiptReview.findFirst({
          where: { receiptId: receipt.id },
          orderBy: { sequenceNo: "desc" },
          select: {
            receiptRevisionNo: true,
            procurementVersionId: true,
            decision: true
          }
        })
      : null;
    const receiptLines = receipt
      ? await tx.spotProcurementReceiptLine.findMany({
          where: {
            receiptId: receipt.id,
            receiptRevisionNo: receipt.currentRevisionNo
          },
          select: {
            procurementLineId: true,
            actualCostCents: true,
            replenishmentPending: true
          }
        })
      : [];
    const allPayments = version
      ? await tx.spotProcurementPayment.findMany({
          where: {
            procurementId,
            invalidatedAt: null
          },
          select: {
            id: true,
            procurementVersionId: true,
            status: true,
            companyPaymentAmountCents: true,
            supplierBalanceAmountCents: true,
            paidAmountCents: true,
            executedSupplierBalanceAmountCents: true,
            canceledCompanyPaymentAmountCents: true,
            canceledSupplierBalanceAmountCents: true,
            invalidatedAt: true
          }
        })
      : [];
    const payments = allPayments.filter(
      (payment) => payment.procurementVersionId === version?.id
    );
    const paymentIds = payments.map((payment) => payment.id);
    const [
      reservations,
      discrepancies,
      refunds,
      balanceCredits,
      allocations,
      noInvoices,
      invoiceExceptions,
      pendingVersionChangeCount
    ] = await Promise.all([
      paymentIds.length
        ? tx.supplierBalanceReservation.findMany({
            where: { paymentId: { in: paymentIds } },
            select: {
              amountCents: true,
              releasedAmountCents: true,
              status: true
            }
          })
        : [],
      tx.spotProcurementDiscrepancy.findMany({
        where: { procurementId, invalidatedAt: null },
        select: {
          status: true,
          procurementVersionId: true,
          receiptId: true,
          receiptRevisionNo: true
        }
      }),
      tx.spotProcurementRefund.findMany({
        where: { procurementId },
        select: { amountCents: true }
      }),
      tx.supplierBalanceEntry.findMany({
        where: { procurementId, entryType: "credit_from_discrepancy" },
        select: { availableDeltaCents: true }
      }),
      tx.invoiceAllocation.findMany({
        where: { procurementId, invalidatedAt: null },
        select: {
          procurementVersionId: true,
          receiptId: true,
          receiptRevisionNo: true,
          procurementLineId: true,
          amountCents: true
        }
      }),
      tx.noInvoiceConfirmation.findMany({
        where: { procurementId, status: { in: ["pending_review", "confirmed"] } },
        select: {
          procurementVersionId: true,
          receiptId: true,
          receiptRevisionNo: true,
          procurementLineId: true,
          amountCents: true,
          status: true
        }
      }),
      tx.invoiceExceptionConfirmation.findMany({
        where: { procurementId, status: { in: ["pending_review", "confirmed"] } },
        select: {
          procurementVersionId: true,
          receiptId: true,
          receiptRevisionNo: true,
          procurementLineId: true,
          amountCents: true,
          status: true
        }
      }),
      tx.spotProcurementVersion.count({
        where: { procurementId, status: { in: ["draft", "approval_pending"] } }
      })
    ]);

    const sameCoordinates = (fact: {
      procurementVersionId: string;
      receiptId: string;
      receiptRevisionNo: number;
    }) =>
      Boolean(version && receipt) &&
      fact.procurementVersionId === version?.id &&
      fact.receiptId === receipt?.id &&
      fact.receiptRevisionNo === receipt?.currentRevisionNo;
    const currentAllocations = allocations.filter(sameCoordinates);
    const currentNoInvoices = noInvoices.filter(sameCoordinates);
    const currentExceptions = invoiceExceptions.filter(sameCoordinates);
    const staleTicketFactCount =
      allocations.length - currentAllocations.length +
      noInvoices.length - currentNoInvoices.length +
      invoiceExceptions.length - currentExceptions.length;
    const lineCoverage = new Map<string, bigint>();
    for (const fact of [
      ...currentAllocations,
      ...currentNoInvoices.filter((row) => row.status === "confirmed"),
      ...currentExceptions.filter((row) => row.status === "confirmed")
    ]) {
      lineCoverage.set(
        fact.procurementLineId,
        (lineCoverage.get(fact.procurementLineId) ?? 0n) + fact.amountCents
      );
    }
    const lineActualCost = new Map(
      receiptLines.map((line) => [line.procurementLineId, line.actualCostCents])
    );
    const duplicateTicketCoverageCount =
      staleTicketFactCount +
      [...lineCoverage].filter(
        ([lineId, amount]) =>
          !lineActualCost.has(lineId) || amount > (lineActualCost.get(lineId) ?? 0n)
      ).length;
    const currentDiscrepancies = discrepancies.filter(
      (row) => sameCoordinates(row)
    );
    const actualCostCents = receipt?.actualCostCents ?? 0n;
    const receiptLineActualCostCents = sum(
      receiptLines.map((line) => line.actualCostCents)
    );
    const hasResolvedShortage = currentDiscrepancies.some(
      (row) => row.status === "resolved"
    );
    const receiptIssuesResolved =
      receiptLines.every((line) => !line.replenishmentPending) &&
      receiptLineActualCostCents === actualCostCents &&
      procurement.actualCostCents === actualCostCents &&
      discrepancies.length === currentDiscrepancies.length &&
      currentDiscrepancies.every((row) => row.status === "resolved") &&
      (actualCostCents === procurement.approvedAmountCents || hasResolvedShortage);
    const companyPaidCents = sum(
      payments.map((payment) => payment.paidAmountCents)
    );
    const executedBalanceCents = sum(
      payments.map((payment) => payment.executedSupplierBalanceAmountCents)
    );
    const refundedCents = sum(refunds.map((refund) => refund.amountCents));
    const transferredBalanceCents = sum(
      balanceCredits.map((entry) => entry.availableDeltaCents)
    );
    const snapshot: SpotProcurementClosureSnapshot = {
      approved:
        procurement.status === "approved_in_progress" &&
        version?.procurementId === procurementId &&
        version.status === "approved" &&
        version.totalAmountCents === procurement.approvedAmountCents,
      receiptReviewed:
        Boolean(receipt?.submittedAt) &&
        receipt?.status === "reviewed" &&
        receipt.procurementVersionId === version?.id &&
        review?.decision === "approved" &&
        review.receiptRevisionNo === receipt.currentRevisionNo &&
        review.procurementVersionId === version?.id,
      receiptIssuesResolved,
      actualCostCents,
      fundsSettledCents:
        companyPaidCents +
        executedBalanceCents -
        refundedCents -
        transferredBalanceCents,
      invoiceCoveredCents:
        sum(currentAllocations.map((row) => row.amountCents)) +
        sum(
          currentExceptions
            .filter((row) => row.status === "confirmed")
            .map((row) => row.amountCents)
        ),
      noInvoiceCoveredCents: sum(
        currentNoInvoices
          .filter((row) => row.status === "confirmed")
          .map((row) => row.amountCents)
      ),
      pendingPaymentCount: payments.filter(
        (payment) => payment.status === "approval_pending"
      ).length,
      pendingCompanyPaymentCount: payments.filter(
        (payment) =>
          ["approved_pending_payment", "partially_paid"].includes(payment.status) &&
          nonnegative(
            payment.companyPaymentAmountCents -
              payment.canceledCompanyPaymentAmountCents -
              payment.paidAmountCents
          ) > 0n
      ).length,
      pendingBalanceReservationCount: reservations.filter(
        (reservation) =>
          reservation.status === "reserved" &&
          reservation.amountCents - reservation.releasedAmountCents > 0n
      ).length,
      pendingRefundCount: currentDiscrepancies.filter(
        (row) => row.status === "awaiting_refund"
      ).length,
      pendingBalanceTransferCount: currentDiscrepancies.filter(
        (row) => row.status === "awaiting_supplier_balance"
      ).length,
      pendingBalanceExecutionCount: payments.filter(
        (payment) =>
          nonnegative(
            payment.supplierBalanceAmountCents -
              payment.canceledSupplierBalanceAmountCents -
              payment.executedSupplierBalanceAmountCents
          ) > 0n
      ).length,
      duplicateTicketCoverageCount,
      pendingInvoiceIssueCount:
        currentNoInvoices.filter((row) => row.status === "pending_review").length +
        currentExceptions.filter((row) => row.status === "pending_review").length,
      pendingVersionChangeCount:
        pendingVersionChangeCount + (allPayments.length - payments.length)
    };
    const evaluation = SpotProcurementClosureService.evaluate(snapshot);
    if (!evaluation.canClose || !receipt) {
      return {
        closed: false,
        alreadyClosed: false,
        blockers: evaluation.blockers,
        snapshot
      };
    }

    const now = new Date();
    const closed = await tx.spotProcurement.updateMany({
      where: {
        id: procurementId,
        status: "approved_in_progress",
        closedAt: null
      },
      data: { status: "closed", closedAt: now }
    });
    if (closed.count !== 1) {
      throw new ConflictException("零星采购办结状态已变化，请刷新后重试");
    }
    const locked = await tx.spotProcurementReceipt.updateMany({
      where: { id: receipt.id, status: "reviewed", lockedAt: null },
      data: { status: "locked", lockedAt: now }
    });
    if (locked.count !== 1) {
      throw new ConflictException("零星采购收货锁定状态已变化，请刷新后重试");
    }
    await this.audit.record(tx, {
      actorUserId,
      action: "spot_procurement.close.auto",
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
      businessId: version?.id ?? procurementId,
      metadata: {
        procurementId,
        projectId: procurement.projectId,
        procurementVersionId: version?.id ?? null,
        receiptId: receipt.id,
        trigger,
        actualCostCents: snapshot.actualCostCents.toString(),
        fundsSettledCents: snapshot.fundsSettledCents.toString(),
        invoiceCoveredCents: snapshot.invoiceCoveredCents.toString(),
        noInvoiceCoveredCents: snapshot.noInvoiceCoveredCents.toString(),
        closedAt: now.toISOString()
      }
    });
    return {
      closed: true,
      alreadyClosed: false,
      blockers: [],
      snapshot
    };
  }
}

function sum(values: readonly bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}

function nonnegative(value: bigint) {
  return value > 0n ? value : 0n;
}

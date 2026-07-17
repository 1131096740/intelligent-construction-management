import { SpotProcurementClosureService } from "./spot-procurement-closure.service";

const completeSnapshot = () => ({
  approved: true,
  receiptReviewed: true,
  receiptIssuesResolved: true,
  actualCostCents: 10_000n,
  fundsSettledCents: 10_000n,
  invoiceCoveredCents: 7_000n,
  noInvoiceCoveredCents: 3_000n,
  pendingPaymentCount: 0,
  pendingCompanyPaymentCount: 0,
  pendingBalanceReservationCount: 0,
  pendingRefundCount: 0,
  pendingBalanceTransferCount: 0,
  pendingBalanceExecutionCount: 0,
  duplicateTicketCoverageCount: 0,
  pendingInvoiceIssueCount: 0,
  pendingVersionChangeCount: 0
});

describe("SpotProcurementClosureService", () => {
  const cases: Array<[string, (snapshot: ReturnType<typeof completeSnapshot>) => void]> = [
    ["version_not_approved", (value) => { value.approved = false; }],
    ["receipt_not_reviewed", (value) => { value.receiptReviewed = false; }],
    ["receipt_issues_unresolved", (value) => { value.receiptIssuesResolved = false; }],
    ["funds_not_settled", (value) => { value.fundsSettledCents -= 1n; }],
    ["tickets_not_covered", (value) => { value.noInvoiceCoveredCents -= 1n; }],
    ["payment_approval_pending", (value) => { value.pendingPaymentCount = 1; }],
    ["company_payment_pending", (value) => { value.pendingCompanyPaymentCount = 1; }],
    ["balance_reservation_pending", (value) => { value.pendingBalanceReservationCount = 1; }],
    ["refund_pending", (value) => { value.pendingRefundCount = 1; }],
    ["balance_transfer_pending", (value) => { value.pendingBalanceTransferCount = 1; }],
    ["balance_execution_pending", (value) => { value.pendingBalanceExecutionCount = 1; }],
    ["duplicate_ticket_coverage", (value) => { value.duplicateTicketCoverageCount = 1; }],
    ["invoice_issue_pending", (value) => { value.pendingInvoiceIssueCount = 1; }],
    ["version_change_pending", (value) => { value.pendingVersionChangeCount = 1; }]
  ];

  it.each(cases)("blocks closure when %s", (blocker, mutate) => {
    const snapshot = completeSnapshot();
    mutate(snapshot);

    expect(SpotProcurementClosureService.evaluate(snapshot)).toEqual({
      canClose: false,
      blockers: [blocker]
    });
  });

  it("allows closure only when every condition is satisfied", () => {
    expect(
      SpotProcurementClosureService.evaluate(completeSnapshot())
    ).toEqual({ canClose: true, blockers: [] });
  });

  it("closes the procurement and locks its receipt in the same transaction", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "procurement-1",
          projectId: "project-1",
          currentVersionId: "version-1",
          status: "approved_in_progress",
          approvedAmountCents: 10_000n,
          actualCostCents: 10_000n
        }
      ]),
      spotProcurementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          procurementId: "procurement-1",
          status: "approved",
          totalAmountCents: 10_000n
        }),
        count: jest.fn().mockResolvedValue(0)
      },
      spotProcurementReceipt: {
        findUnique: jest.fn().mockResolvedValue({
          id: "receipt-1",
          procurementVersionId: "version-1",
          currentRevisionNo: 1,
          status: "reviewed",
          submittedAt: new Date(),
          actualCostCents: 10_000n
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      spotProcurementReceiptReview: {
        findFirst: jest.fn().mockResolvedValue({
          receiptRevisionNo: 1,
          procurementVersionId: "version-1",
          decision: "approved"
        })
      },
      spotProcurementReceiptLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            procurementLineId: "line-1",
            actualCostCents: 10_000n,
            replenishmentPending: false
          }
        ])
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            procurementVersionId: "version-1",
            status: "paid",
            companyPaymentAmountCents: 10_000n,
            supplierBalanceAmountCents: 0n,
            paidAmountCents: 10_000n,
            executedSupplierBalanceAmountCents: 0n,
            canceledCompanyPaymentAmountCents: 0n,
            canceledSupplierBalanceAmountCents: 0n,
            invalidatedAt: null
          }
        ])
      },
      supplierBalanceReservation: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementDiscrepancy: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementRefund: { findMany: jest.fn().mockResolvedValue([]) },
      supplierBalanceEntry: { findMany: jest.fn().mockResolvedValue([]) },
      invoiceAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            procurementVersionId: "version-1",
            receiptId: "receipt-1",
            receiptRevisionNo: 1,
            procurementLineId: "line-1",
            amountCents: 7_000n
          }
        ])
      },
      noInvoiceConfirmation: {
        findMany: jest.fn().mockResolvedValue([
          {
            procurementVersionId: "version-1",
            receiptId: "receipt-1",
            receiptRevisionNo: 1,
            procurementLineId: "line-1",
            amountCents: 3_000n,
            status: "confirmed"
          }
        ])
      },
      invoiceExceptionConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurement: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SpotProcurementClosureService(audit as never);

    const result = await service.recalculateAndClose(
      tx as never,
      "procurement-1",
      "payment.execution.record",
      "finance-1"
    );

    expect(result.closed).toBe(true);
    expect(tx.spotProcurement.updateMany).toHaveBeenCalledWith({
      where: { id: "procurement-1", status: "approved_in_progress", closedAt: null },
      data: { status: "closed", closedAt: expect.any(Date) }
    });
    expect(tx.spotProcurementReceipt.updateMany).toHaveBeenCalledWith({
      where: { id: "receipt-1", status: "reviewed", lockedAt: null },
      data: { status: "locked", lockedAt: expect.any(Date) }
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});

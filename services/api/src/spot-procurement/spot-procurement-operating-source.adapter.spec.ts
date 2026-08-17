import {
  SpotProcurementInvoiceOperatingSourceAdapter,
  SpotProcurementPaymentExecutionOperatingSourceAdapter,
  SpotProcurementRefundOperatingSourceAdapter,
  SpotProcurementReceiptOperatingSourceAdapter
} from "./spot-procurement-operating-source.adapter";
import type { OperatingSourceSnapshot } from "../operating-ledger/operating-source-adapter";

describe("POL-07 spot procurement operating sources", () => {
  it("maps an approved receipt exactly once to material cost without cash movement", () => {
    const mapped = new SpotProcurementReceiptOperatingSourceAdapter().toOperatingFactInput(
      snapshot("spot_procurement_receipt_review", "receipt-review-1", {
        receiptId: "receipt-1",
        procurementId: "procurement-1",
        procurementCode: "LXCG-2026-0001",
        receiptRevisionNo: "2",
        actualCostCents: "8800",
        reviewedAt: "2026-08-15T02:00:00.000Z",
        confirmedAt: "2026-08-15T02:00:00.000Z",
        reviewedByUserId: "material-director-1"
      })
    );

    expect(mapped.entryKind).toBe("original");
    expect(mapped.input).toEqual(
      expect.objectContaining({
        factKind: "expense",
        amountCents: 8800n,
        subjects: {
          costBearingCompany: {
            kind: "construction_enterprise",
            id: "affiliate-version-1"
          }
        }
      })
    );
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "confirmed_cost",
        direction: "increase",
        amountCents: 8800n,
        costCategoryCode: "material"
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impactKind: "company_project_funds_decrease"
        })
      ])
    );
  });

  it("maps a real payment to company funds without a second material cost", () => {
    const mapped =
      new SpotProcurementPaymentExecutionOperatingSourceAdapter().toOperatingFactInput(
        snapshot("spot_procurement_payment_execution", "execution-1", {
          paymentId: "payment-1",
          procurementId: "procurement-1",
          procurementCode: "LXCG-2026-0001",
          amountCents: "8800",
          paidAt: "2026-08-15T03:00:00.000Z",
          confirmedAt: "2026-08-15T03:00:00.000Z",
          executedByUserId: "finance-1",
          paymentType: "company_direct",
          payerCompanyEntityId: "company-1",
          payeeId: "downstream:供应商甲",
          voucherFileIds: ["voucher-1"]
        })
      );

    expect(mapped.input).toEqual(
      expect.objectContaining({
        factKind: "downstream_payment",
        amountCents: 8800n,
        subjects: expect.objectContaining({
          actualPayer: { kind: "participating_company", id: "company-1" },
          payee: { kind: "downstream_counterparty", id: "downstream:供应商甲" }
        })
      })
    );
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "company_project_funds_decrease",
        amountCents: 8800n,
        subject: { kind: "participating_company", id: "company-1" }
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ impactKind: "confirmed_cost" })])
    );
  });

  it("links a refund to its receipt and payment while reversing the cash result without new cost", () => {
    const mapped = new SpotProcurementRefundOperatingSourceAdapter().toOperatingFactInput(
      snapshot("spot_procurement_refund", "refund-1", {
        receiptReviewId: "receipt-review-1",
        paymentId: "payment-1",
        procurementId: "procurement-1",
        procurementCode: "LXCG-2026-0001",
        amountCents: "1200",
        receivedAt: "2026-08-15T04:00:00.000Z",
        confirmedAt: "2026-08-15T04:00:00.000Z",
        recordedByUserId: "finance-1",
        paymentType: "company_direct",
        payerCompanyEntityId: "company-1",
        refundCounterpartyId: "downstream:供应商甲",
        voucherFileId: "refund-voucher-1"
      })
    );

    expect(mapped.input).toEqual(
      expect.objectContaining({
        factKind: "fund_movement",
        direction: "inflow",
        amountCents: 1200n,
        subjects: expect.objectContaining({
          actualPayer: { kind: "downstream_counterparty", id: "downstream:供应商甲" },
          payee: { kind: "participating_company", id: "company-1" }
        })
      })
    );
    expect(mapped.input.basisSnapshot).toEqual(
      expect.objectContaining({
        originalPaymentId: "payment-1",
        originalReceiptReviewId: "receipt-review-1"
      })
    );
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "company_project_funds_increase",
        amountCents: 1200n
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ impactKind: "confirmed_cost" })])
    );
  });

  it("maps a legacy payment to construction-enterprise funds without assigning a company", () => {
    const mapped =
      new SpotProcurementPaymentExecutionOperatingSourceAdapter().toOperatingFactInput(
        snapshot("spot_procurement_payment_execution", "execution-legacy-1", {
          paymentId: "payment-legacy-1",
          procurementId: "procurement-1",
          procurementCode: "LXCG-2026-0001",
          amountCents: "8800",
          paidAt: "2026-08-15T03:00:00.000Z",
          confirmedAt: "2026-08-15T03:00:00.000Z",
          executedByUserId: "finance-1",
          payeeId: "downstream:供应商甲",
          voucherFileIds: ["voucher-legacy-1"]
        })
      );

    expect(mapped.input).toEqual(
      expect.objectContaining({
        operatingLevel: "project",
        subjects: expect.objectContaining({
          actualPayer: {
            kind: "construction_enterprise",
            id: "affiliate-version-1"
          }
        })
      })
    );
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "construction_enterprise_funds_decrease",
        subject: { kind: "construction_enterprise", id: "affiliate-version-1" }
      })
    ]);
  });

  it("maps a legacy refund back to construction-enterprise funds without new cost", () => {
    const mapped = new SpotProcurementRefundOperatingSourceAdapter().toOperatingFactInput(
      snapshot("spot_procurement_refund", "refund-legacy-1", {
        receiptReviewId: "receipt-review-1",
        paymentId: "payment-legacy-1",
        procurementId: "procurement-1",
        procurementCode: "LXCG-2026-0001",
        amountCents: "1200",
        receivedAt: "2026-08-15T04:00:00.000Z",
        confirmedAt: "2026-08-15T04:00:00.000Z",
        recordedByUserId: "finance-1",
        refundCounterpartyId: "downstream:供应商甲",
        voucherFileId: "refund-voucher-legacy-1"
      })
    );

    expect(mapped.input).toEqual(
      expect.objectContaining({
        operatingLevel: "project",
        subjects: expect.objectContaining({
          payee: {
            kind: "construction_enterprise",
            id: "affiliate-version-1"
          }
        })
      })
    );
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "construction_enterprise_funds_increase",
        subject: { kind: "construction_enterprise", id: "affiliate-version-1" }
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ impactKind: "confirmed_cost" })])
    );
  });

  it("records a structured invoice as tax evidence without revenue or cost", () => {
    const mapped = new SpotProcurementInvoiceOperatingSourceAdapter().toOperatingFactInput(
      snapshot("spot_procurement_invoice_record", "invoice-1", {
        invoiceRecordId: "invoice-1",
        procurementId: "procurement-1",
        procurementCode: "LXCG-2026-0001",
        sellerName: "供应商甲",
        buyerName: "我方公司甲",
        payeeId: "downstream:供应商甲",
        totalAmountCents: "8800",
        issueDate: "2026-08-15T00:00:00.000Z",
        confirmedAt: "2026-08-15T05:00:00.000Z",
        uploadedByUserId: "finance-1",
        invoiceIdentity: "INV-2026-0001",
        fileId: "invoice-file-1"
      })
    );

    expect(mapped.input).toEqual(
      expect.objectContaining({
        factKind: "invoice",
        direction: "neutral",
        amountCents: 8800n,
        subjects: { payee: { kind: "downstream_counterparty", id: "downstream:供应商甲" } }
      })
    );
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "invoice_reference",
        direction: "notice",
        amountCents: 8800n
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ impactKind: "confirmed_income" }),
        expect.objectContaining({ impactKind: "confirmed_cost" })
      ])
    );
  });
});

function snapshot(
  sourceType: string,
  sourceBusinessId: string,
  sourceSnapshot: Record<string, unknown>
): OperatingSourceSnapshot {
  return {
    projectId: "project-1",
    sourceType,
    sourceBusinessId,
    sourceBusinessCode: "零采收货/LXCG-2026-0001/第2版",
    sourceVersion: 2,
    status: "confirmed",
    sourceSnapshot: {
      formalStatus: "confirmed",
      operatingLedgerEffectiveDate: "2026-08-01T00:00:00.000Z",
      affiliate: {
        assignmentId: "affiliate-assignment-1",
        businessPartyVersionId: "affiliate-version-1",
        name: "施工企业甲",
        creditCode: null
      },
      ...sourceSnapshot
    } as never
  };
}

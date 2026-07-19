import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
import {
  appendSpotProcurementPaymentInvoice,
  createSpotProcurementDiscrepancy,
  createSpotProcurementDraft,
  fetchSpotProcurementCreateProjectOptions,
  fetchSpotProcurementApplicationTextSuggestions,
  createSpotProcurementPaymentDraft,
  createSpotProcurementVersion,
  fetchSpotProcurementCapabilities,
  fetchSpotProcurementDetail,
  fetchSpotProcurementPaymentDetail,
  fetchSpotProcurementReceipt,
  fetchSpotProcurementPayments,
  fetchSpotProcurements,
  fetchVatRateOptions,
  recordSpotProcurementPaymentExecution,
  recordSpotProcurementRefund,
  submitSpotProcurementReceipt,
  reviewSpotProcurement,
  reviewSpotProcurementA5Payment,
  reviewSpotProcurementPayment,
  submitSpotProcurement,
  submitSpotProcurementPayment,
  updateSpotProcurementDraft,
  updateSpotProcurementPaymentDraft,
  updateSpotProcurementPaymentPayer,
  voidSpotProcurement,
  voidSpotProcurementPayment,
  withdrawSpotProcurement,
  withdrawSpotProcurementPayment,
  type CreateSpotProcurementDraftPayload,
  type RecordSpotProcurementPaymentExecutionPayload,
  type ReviewSpotProcurementA5PaymentPayload
} from "./spot-procurement.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

describe("spot procurement API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation(async () => jsonResponse({ id: "ok" }));
  });

  it("reads capabilities and the controlled VAT-rate dictionary", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse({ enabled: true }))
      .mockResolvedValueOnce(
        jsonResponse([
          { id: "vat-3", label: "3%", rateValue: "0.03", enabled: true }
        ])
      );

    await fetchSpotProcurementCapabilities("project/1");
    await expect(fetchVatRateOptions()).resolves.toEqual([
      { id: "vat-3", label: "3%", rateValue: "0.03", isEnabled: true }
    ]);

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/capabilities?projectId=project%2F1",
      "/vat-rate-options"
    ]);
  });

  it("reads only the current user's zero-procurement creation projects", async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse([{ id: "project-1", code: "XM-001", name: "一号项目" }])
    );

    await expect(fetchSpotProcurementCreateProjectOptions()).resolves.toEqual([
      { id: "project-1", code: "XM-001", name: "一号项目" }
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurements/create-project-options"
    );
  });

  it("reads the procurement list and detail with encoded query and resource ids", async () => {
    await fetchSpotProcurements({
      projectId: "project/1",
      status: "approval_pending",
      keyword: " 水泥/砖 "
    });
    await fetchSpotProcurementDetail("procurement/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements?projectId=project%2F1&status=approval_pending&keyword=%E6%B0%B4%E6%B3%A5%2F%E7%A0%96",
      "/spot-procurements/procurement%2F1"
    ]);
  });

  it("reads the payment list and detail without adding empty filters", async () => {
    await fetchSpotProcurementPayments({
      projectId: "project/1",
      status: "approved_pending_payment",
      keyword: "  "
    });
    await fetchSpotProcurementPaymentDetail("payment/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments?projectId=project%2F1&status=approved_pending_payment",
      "/spot-procurement-payments/payment%2F1"
    ]);
  });

  it("passes the server-owned payment workbench view while keeping omission compatible", async () => {
    await fetchSpotProcurementPayments({ view: "all" });
    await fetchSpotProcurementPayments();

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments?view=all",
      "/spot-procurement-payments"
    ]);
  });

  it("connects the final receipt read and submission routes", async () => {
    await fetchSpotProcurementReceipt("procurement/1");
    await submitSpotProcurementReceipt("procurement/1");
    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/procurement%2F1/receipt",
      "/spot-procurements/procurement%2F1/receipt/submission"
    ]);
  });

  it("uses only replenishment or refund for real-form shortage handling and appends a payment-level invoice", async () => {
    const refund = {
      amountCents: "1200",
      receivedAt: "2026-07-18",
      refundMethod: "bank_transfer" as const,
      voucherFileId: "refund-voucher-1",
      idempotencyKey: "refund-1"
    };

    await createSpotProcurementDiscrepancy("procurement/1", {
      operation: "initiate",
      resolutionType: "replenishment",
      note: "商户承诺补货"
    });
    await recordSpotProcurementRefund("procurement/1", refund);
    await appendSpotProcurementPaymentInvoice("payment/1", "invoice-file-1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/procurement%2F1/discrepancy",
      "/spot-procurements/procurement%2F1/refunds",
      "/spot-procurement-payments/payment%2F1/invoices"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({
        operation: "initiate",
        resolutionType: "replenishment",
        note: "商户承诺补货"
      }),
      JSON.stringify(refund),
      JSON.stringify({ fileId: "invoice-file-1" })
    ]);
  });

  it("reads bounded application text suggestions within a project", async () => {
    await fetchSpotProcurementApplicationTextSuggestions("project/1", "工程部");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/application-text-suggestions?projectId=project%2F1&keyword=%E5%B7%A5%E7%A8%8B%E9%83%A8"
    ]);
  });

  it("connects every procurement write route and preserves the JSON body", async () => {
    const draft: CreateSpotProcurementDraftPayload = {
      projectId: "project-1",
      applicationDepartment: "工程部",
      applicationName: "杨帅",
      requestedArrivalAt: "2026-07-18",
      reason: "现场临时补料",
      note: "当日送达",
      lines: [
        {
          materialName: "免烧砖",
          specification: "240x115x53",
          unit: "块",
          quantity: "1000",
          note: "免烧砖"
        }
      ],
      attachments: [{ fileId: "quote-1", category: "merchant_quote" }],
    };

    await createSpotProcurementDraft(draft);
    await updateSpotProcurementDraft("procurement/1", draft);
    await createSpotProcurementVersion("procurement/1", {
      ...draft,
      changeReason: "修改使用部位"
    });
    await submitSpotProcurement("procurement/1");
    await reviewSpotProcurement("procurement/1", {
      decision: "approve",
      comment: "同意"
    });
    await withdrawSpotProcurement("procurement/1");
    await voidSpotProcurement("procurement/1", { reason: "现场取消需求" });
    await createSpotProcurementPaymentDraft("procurement/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements",
      "/spot-procurements/procurement%2F1/draft",
      "/spot-procurements/procurement%2F1/versions",
      "/spot-procurements/procurement%2F1/submission",
      "/spot-procurements/procurement%2F1/approval",
      "/spot-procurements/procurement%2F1/approval-withdrawal",
      "/spot-procurements/procurement%2F1/voiding",
      "/spot-procurements/procurement%2F1/payments"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "PATCH",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST"
    ]);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/spot-procurements",
      expect.objectContaining({ body: JSON.stringify(draft) })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/spot-procurements/procurement%2F1/versions",
      expect.objectContaining({
        body: JSON.stringify({ ...draft, changeReason: "修改使用部位" })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      5,
      "/spot-procurements/procurement%2F1/approval",
      expect.objectContaining({
        body: JSON.stringify({ decision: "approve", comment: "同意" })
      })
    );
    expect(mockApiFetch.mock.calls[3]?.[1]?.body).toBe("{}");
    expect(mockApiFetch.mock.calls[5]?.[1]?.body).toBe("{}");
    expect(mockApiFetch.mock.calls[7]?.[1]?.body).toBe("{}");
  });

  it("connects A5 payment facts, payer controls and review safeguards", async () => {
    const draft = {
      paymentType: "company_direct" as const,
      merchantName: "朝阳建材",
      payeeName: "朝阳建材",
      paymentLines: [{ procurementLineId: "line-1", paymentQuantity: "100", unitPrice: "4.00", expectedInvoiceCondition: "vat_general" as const, vatRateOptionId: "vat-13" }],
      channels: [{ channelType: "bank_transfer" as const, accountName: "朝阳建材", accountNumber: "6222000012345678", bankName: "建设银行", isPrimary: true }],
      paymentMethods: ["bank_transfer" as const],
      attachments: [{ fileId: "quote-1", category: "merchant_quote" as const }]
    };
    const review = {
      decision: "return_to_applicant" as const,
      comment: "按可用余额调整",
      adjustedSupplierBalanceAmountCents: "3000",
      selfReviewReason: "本人为当前必经岗位",
      confirmationPassword: "correct-password"
    };

    await updateSpotProcurementPaymentDraft("payment/1", draft);
    await updateSpotProcurementPaymentPayer("payment/1", {
      companyEntityId: "company-1",
      paymentMethods: ["bank_transfer"],
      changeReason: "付款主体调整"
    });
    await submitSpotProcurementPayment("payment/1");
    await reviewSpotProcurementPayment("payment/1", review);
    await withdrawSpotProcurementPayment("payment/1");
    await voidSpotProcurementPayment("payment/1", { reason: "重新发起" });

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments/payment%2F1/draft",
      "/spot-procurement-payments/payment%2F1/payer",
      "/spot-procurement-payments/payment%2F1/submission",
      "/spot-procurement-payments/payment%2F1/approval",
      "/spot-procurement-payments/payment%2F1/approval-withdrawal",
      "/spot-procurement-payments/payment%2F1/voiding"
    ]);
    expect(mockApiFetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(draft) })
    );
    expect(mockApiFetch.mock.calls[3]?.[1]).toEqual(
      expect.objectContaining({ method: "POST", body: JSON.stringify(review) })
    );
    expect(mockApiFetch.mock.calls[5]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ reason: "重新发起" })
      })
    );
  });

  it("exposes an A5-specific review contract that excludes reject", async () => {
    expectTypeOf<
      ReviewSpotProcurementA5PaymentPayload["decision"]
    >().toEqualTypeOf<"approve" | "return_to_applicant">();
    const review: ReviewSpotProcurementA5PaymentPayload = {
      decision: "return_to_applicant",
      comment: "请补充付款依据"
    };

    await reviewSpotProcurementA5Payment("payment/1", review);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurement-payments/payment%2F1/approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(review)
      })
    );
  });

  it("reuses the caller-provided execution idempotency key across retries", async () => {
    const execution: RecordSpotProcurementPaymentExecutionPayload = {
      amountCents: "50000",
      paidAt: "2026-07-17T08:00:00.000Z",
      paymentMethod: "bank_transfer",
      voucherFileId: "voucher-1",
      idempotencyKey: "payment-1:execution-attempt-1",
      confirmationPassword: "correct-password"
    };

    await recordSpotProcurementPaymentExecution("payment/1", execution);
    await recordSpotProcurementPaymentExecution("payment/1", execution);

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    for (const [, init] of mockApiFetch.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(execution)
        })
      );
    }
  });

  it("surfaces server validation messages and masks technical failures", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse({ message: ["请填写供应商名称", "请至少填写一条采购明细"] }, 400)
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: "Internal server error" }, 500)
      );

    await expect(createSpotProcurementDraft({} as CreateSpotProcurementDraftPayload)).rejects.toThrow(
      "请填写供应商名称；请至少填写一条采购明细"
    );
    await expect(fetchSpotProcurementDetail("procurement-1")).rejects.toThrow(
      "系统暂时无法完成操作，请稍后重试或联系管理员。"
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

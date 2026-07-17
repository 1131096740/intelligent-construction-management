import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
import {
  createSpotProcurementDraft,
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
  submitSpotProcurementReceipt,
  reviewSpotProcurement,
  reviewSpotProcurementPayment,
  submitSpotProcurement,
  submitSpotProcurementPayment,
  updateSpotProcurementDraft,
  updateSpotProcurementPaymentDraft,
  voidSpotProcurement,
  voidSpotProcurementPayment,
  withdrawSpotProcurement,
  withdrawSpotProcurementPayment,
  type CreateSpotProcurementDraftPayload,
  type RecordSpotProcurementPaymentExecutionPayload
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

  it("connects the final receipt read and submission routes", async () => {
    await fetchSpotProcurementReceipt("procurement/1");
    await submitSpotProcurementReceipt("procurement/1");
    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/procurement%2F1/receipt",
      "/spot-procurements/procurement%2F1/receipt/submission"
    ]);
  });

  it("connects every procurement write route and preserves the JSON body", async () => {
    const draft: CreateSpotProcurementDraftPayload = {
      projectId: "project-1",
      code: "LXCG-001",
      supplierPartyId: "party-1",
      supplierName: "朝阳建材",
      handlerUserId: "material-1",
      reason: "现场临时补料",
      note: "当日送达",
      lines: [
        {
          materialName: "免烧砖",
          specification: "240x115x53",
          unit: "块",
          quantity: "1000",
          invoiceMode: "invoice",
          invoiceType: "vat_general",
          vatRateOptionId: "vat-3",
          unitPrice: "0.55",
          usageLocation: "2#楼",
          note: "免烧砖",
          amountCents: "55000"
        }
      ],
      attachments: [{ fileId: "quote-1", category: "merchant_quote" }],
      totalAmountCents: "55000"
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

  it("connects every payment write route and preserves review safeguards", async () => {
    const draft = {
      settlementAmountCents: "55000",
      supplierBalanceAmountCents: "5000",
      companyPaymentAmountCents: "50000",
      paymentPath: "supplier_direct" as const,
      paymentMethod: "bank_transfer" as const,
      payeeAccountName: "朝阳建材",
      payeeBankName: "建设银行",
      payeeBankAccount: "6222000012345678",
      expectedPaymentAt: "2026-07-18",
      paymentNote: "零星材料款",
      supportingAttachmentFileId: "support-1",
      merchantPaymentProofFileId: null
    };
    const review = {
      decision: "return_to_applicant" as const,
      comment: "按可用余额调整",
      adjustedSupplierBalanceAmountCents: "3000",
      selfReviewReason: "本人为当前必经岗位",
      confirmationPassword: "correct-password"
    };

    await updateSpotProcurementPaymentDraft("payment/1", draft);
    await submitSpotProcurementPayment("payment/1");
    await reviewSpotProcurementPayment("payment/1", review);
    await withdrawSpotProcurementPayment("payment/1");
    await voidSpotProcurementPayment("payment/1", { reason: "重新发起" });

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments/payment%2F1/draft",
      "/spot-procurement-payments/payment%2F1/submission",
      "/spot-procurement-payments/payment%2F1/approval",
      "/spot-procurement-payments/payment%2F1/approval-withdrawal",
      "/spot-procurement-payments/payment%2F1/voiding"
    ]);
    expect(mockApiFetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(draft) })
    );
    expect(mockApiFetch.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ method: "POST", body: JSON.stringify(review) })
    );
    expect(mockApiFetch.mock.calls[4]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ reason: "重新发起" })
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

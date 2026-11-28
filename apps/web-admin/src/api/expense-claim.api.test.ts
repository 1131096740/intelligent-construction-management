import { beforeEach, describe, expect, it, vi } from "vitest";
import { adjustExpenseClaimPaymentSubject, appendExpenseClaimAttachment, attachExpenseClaimAttachment, createExpenseClaim, editReturnedExpenseClaimDraft, fetchExpenseClaimActionCapability, fetchExpenseClaimCreateOptions, fetchExpenseClaimDetail, fetchExpenseClaimExpenseCategories, fetchExpenseClaimSelectablePurchaseBatches, generateExpenseClaimFinalPaymentPdf, recordExpenseClaimPayment, removeExpenseClaimAttachment, reviewExpenseClaim, submitExpenseClaim, withdrawExpenseClaim, type CreateExpenseClaimPayload } from "./expense-claim.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("expense claim API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a claim detail through the encoded new-domain resource path", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", code: "BX-1", lines: [] }), { status: 200 }));

    await expect(fetchExpenseClaimDetail("claim/1")).resolves.toMatchObject({ id: "claim-1", lines: [] });

    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1");
  });

  it.each([
    [undefined, "/expense-claims/claim%2F1/capability"],
    [{ scopeKey: "public_cash" }, "/expense-claims/claim%2F1/capability?scopeKey=public_cash"]
  ] as const)("loads capabilities for the requested payment scope", async (funding, resource) => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ claimId: "claim/1", availableActions: [] })));

    await expect(fetchExpenseClaimActionCapability("claim/1", funding)).resolves.toMatchObject({ claimId: "claim/1" });
    expect(mockApiFetch).toHaveBeenCalledWith(resource);
  });

  it("loads authorized creation options and posts canonical cents payloads", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ companyEntities: [], projects: [], canProxy: false, applicantUsers: [], factWitnessUsers: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "claim-1", code: "BX-1", status: "draft", requestedAmountCents: "100" }), { status: 201 }));

    await expect(fetchExpenseClaimCreateOptions()).resolves.toMatchObject({ canProxy: false });
    const draft: CreateExpenseClaimPayload = {
      claimType: "reimbursement",
      companyEntityId: "company-1",
      applicantUserId: "user-1",
      factWitnessUserId: "witness-1",
      reason: "现场交通",
      requestedAmountCents: "100",
      lines: [{ expenseCategory: "交通", occurredOn: "2026-07-23", purpose: "现场交通", receiptCount: 1, amountCents: "100", evidenceType: "invoice" as const }]
    };
    await expect(createExpenseClaim(draft)).resolves.toMatchObject({ id: "claim-1", code: "BX-1" });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/expense-claims/create-options");
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/expense-claims", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(draft)
    }));
  });

  it("loads reusable company expense categories and manually selectable purchase batches", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ categories: [{ name: "餐饮", isDefault: true, usageCount: 2 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ batches: [{ batchId: "batch-1", supplierName: "五金供应商", availableAmountCents: "40000" }] }), { status: 200 }));

    await expect(fetchExpenseClaimExpenseCategories("company/1")).resolves.toMatchObject({
      categories: [{ name: "餐饮", isDefault: true, usageCount: 2 }]
    });
    await expect(fetchExpenseClaimSelectablePurchaseBatches({ companyEntityId: "company/1", projectId: "project 1" })).resolves.toMatchObject({
      batches: [{ batchId: "batch-1" }]
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/expense-claims/expense-categories?companyEntityId=company%2F1");
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/expense-claims/selectable-purchase-batches?companyEntityId=company%2F1&projectId=project+1");
  });

  it("posts a purchase advance reimbursement with batch, quantity and no procurement request key", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-2", code: "BX-2", status: "draft", requestedAmountCents: "40000" }), { status: 201 }));
    const draft: CreateExpenseClaimPayload = {
      actualPurchaseBatchId: "batch-1",
      claimType: "reimbursement",
      companyEntityId: "company-1",
      projectId: "project-1",
      applicantUserId: "user-1",
      reason: "员工垫付采购款",
      requestedAmountCents: "40000",
      payeeName: "员工甲",
      lines: [{ expenseCategory: "零星材料", occurredOn: "2026-11-20", purpose: "垫付角钢", quantity: "4", receiptCount: 1, amountCents: "40000", evidenceType: "invoice" }]
    };
    await expect(createExpenseClaim(draft)).resolves.toMatchObject({ id: "claim-2" });
    expect(mockApiFetch).toHaveBeenLastCalledWith("/expense-claims", expect.objectContaining({ method: "POST", body: JSON.stringify(draft) }));
    expect(JSON.stringify(draft)).not.toContain("generalProcurementRequestKey");
  });

  it("posts a project-scoped incidental expense without inventing an attachment", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "claim-incidental-1",
          code: "LXFY-1",
          status: "draft",
          requestedAmountCents: "500000"
        }),
        { status: 201 }
      )
    );
    const draft: CreateExpenseClaimPayload = {
      claimType: "incidental_expense",
      incidentalExpenseCategory: "temporary_machinery_shift",
      companyEntityId: "company-1",
      projectId: "project-1",
      applicantUserId: "user-1",
      reason: "临时机械台班",
      requestedAmountCents: "500000"
    };

    await expect(createExpenseClaim(draft)).resolves.toMatchObject({
      code: "LXFY-1"
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/expense-claims",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(draft)
      })
    );
    expect(JSON.parse(String(mockApiFetch.mock.calls[0]?.[1]?.body))).not.toHaveProperty(
      "attachmentFileId"
    );
  });

  it("submits a draft through its encoded new-domain action path", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", status: "approval_pending", submittedAt: "2026-07-23T10:00:00.000Z" }), { status: 201 }));
    await expect(submitExpenseClaim("claim/1")).resolves.toMatchObject({ status: "approval_pending" });
    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1/submission", { method: "POST" });
  });

  it("withdraws a named approval round and updates the same draft with its saved version", async () => {
    const updatedAt = "2026-11-24T08:00:00.000Z";
    const draftEdit = { expectedUpdatedAt: updatedAt, reason: "调整零星费用", requestedAmountCents: "12500" };
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "claim-1", status: "draft" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "claim-1", status: "draft", requestedAmountCents: "12500" }), { status: 200 }));

    await expect(withdrawExpenseClaim("claim/1", "round-1")).resolves.toMatchObject({ status: "draft" });
    await expect(editReturnedExpenseClaimDraft("claim/1", draftEdit)).resolves.toMatchObject({ requestedAmountCents: "12500" });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/expense-claims/claim%2F1/withdrawal", expect.objectContaining({
      method: "POST", body: JSON.stringify({ approvalInstanceId: "round-1" })
    }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/expense-claims/claim%2F1/draft", expect.objectContaining({
      method: "PATCH", body: JSON.stringify(draftEdit)
    }));
  });

  it("reviews only through the encoded expense approval action path", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", status: "approval_pending", completed: false }), { status: 201 }));
    await expect(reviewExpenseClaim("claim/1", { decision: "reject", comment: "请补充依据" })).resolves.toMatchObject({ completed: false });
    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1/approval", expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "reject", comment: "请补充依据" }) }));
  });

  it("submits an exact parallel round and duty while retaining self-review confirmation", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", status: "approval_pending", completed: false }), { status: 201 }));
    const payload = {
      decision: "approve" as const,
      approvalInstanceId: "round-1",
      approvalDutyIndex: 0,
      selfReviewReason: "本人负责该项费用的复核",
      confirmationPassword: "fixture-confirmation"
    };

    await reviewExpenseClaim("claim/1", payload);

    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1/approval", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(payload)
    }));
  });

  it("binds and removes draft attachments through encoded, server-owned expense actions", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "attachment-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "attachment-1" }), { status: 201 }));

    await expect(attachExpenseClaimAttachment("claim/1", {
      fileId: "file-1", category: "receipt_or_other", expenseCategory: "交通"
    })).resolves.toMatchObject({ id: "attachment-1" });
    await expect(removeExpenseClaimAttachment("claim/1", "attachment/1")).resolves.toMatchObject({ id: "attachment-1" });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/expense-claims/claim%2F1/attachments", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ fileId: "file-1", category: "receipt_or_other", expenseCategory: "交通" })
    }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/expense-claims/claim%2F1/attachments/attachment%2F1/removal", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({})
    }));
  });

  it("appends post-submission evidence through the dedicated auditable action", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "attachment-2" }), { status: 201 }));

    await expect(appendExpenseClaimAttachment("claim/1", {
      fileId: "file-2", category: "other", expenseCategory: "差旅"
    })).resolves.toMatchObject({ id: "attachment-2" });

    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1/attachments/append", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ fileId: "file-2", category: "other", expenseCategory: "差旅" })
    }));
  });

  it("adjusts the actual reimbursement payer through the encoded auditable action", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", paymentSubjectCompanyEntityId: "company-pay" }), { status: 201 }));

    await expect(adjustExpenseClaimPaymentSubject("claim/1", {
      companyEntityId: "company-pay", reason: "集团统一付款"
    })).resolves.toMatchObject({ paymentSubjectCompanyEntityId: "company-pay" });

    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1/payment-subject", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ companyEntityId: "company-pay", reason: "集团统一付款" })
    }));
  });

  it("records a voucher-backed company payment and regenerates only its final source PDF", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "execution-1", status: "paid", paidAmountCents: "1200" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ pdfDocumentId: "pdf-1", fileId: "file-1", existed: false }), { status: 201 }));

    await expect(recordExpenseClaimPayment("claim/1", { amountCents: "1200", paidAt: "2026-07-24", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password" })).resolves.toMatchObject({ status: "paid" });
    await expect(generateExpenseClaimFinalPaymentPdf("claim/1")).resolves.toMatchObject({ pdfDocumentId: "pdf-1" });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/expense-claims/claim%2F1/payments", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/expense-claims/claim%2F1/final-payment-pdf", { method: "POST" });
  });

});

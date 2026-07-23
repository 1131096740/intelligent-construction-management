import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendExpenseClaimAttachment, attachExpenseClaimAttachment, createExpenseClaim, fetchExpenseClaimCreateOptions, fetchExpenseClaimDetail, fetchExpenseClaims, removeExpenseClaimAttachment, reviewExpenseClaim, submitExpenseClaim, type CreateExpenseClaimPayload } from "./expense-claim.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("expense claim API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the current user's new-domain claims with the selected server-side view", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify([{ id: "claim-1", code: "BX-1" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(fetchExpenseClaims("pending_funds")).resolves.toEqual([
      expect.objectContaining({ id: "claim-1", code: "BX-1" })
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims?view=pending_funds");
  });

  it("keeps the all view free of a misleading client-side query", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await fetchExpenseClaims();

    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims");
  });

  it("loads a claim detail through the encoded new-domain resource path", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", code: "BX-1", lines: [] }), { status: 200 }));

    await expect(fetchExpenseClaimDetail("claim/1")).resolves.toMatchObject({ id: "claim-1", lines: [] });

    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1");
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

  it("submits a draft through its encoded new-domain action path", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", status: "approval_pending", submittedAt: "2026-07-23T10:00:00.000Z" }), { status: 201 }));
    await expect(submitExpenseClaim("claim/1")).resolves.toMatchObject({ status: "approval_pending" });
    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1/submission", { method: "POST" });
  });

  it("reviews only through the encoded expense approval action path", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "claim-1", status: "approval_pending", completed: false }), { status: 201 }));
    await expect(reviewExpenseClaim("claim/1", { decision: "reject", comment: "请补充依据" })).resolves.toMatchObject({ completed: false });
    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims/claim%2F1/approval", expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "reject", comment: "请补充依据" }) }));
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
});

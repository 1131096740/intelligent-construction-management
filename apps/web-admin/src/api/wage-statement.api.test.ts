import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createApprovedWageSource,
  createWageStatementDraft,
  fetchWageStatementCapabilities,
  fetchWageStatementImportPreview,
  fetchWageStatementSummary,
  fetchWageStatementWorkbench,
  confirmWageStatement,
  returnWageStatement,
  submitWageStatement,
  WageStatementApiError
} from "./wage-statement.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("wage statement workbench API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses only the aggregate read endpoints and URL-encodes the selected aggregate", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ canPrepare: true, canSubmit: false, canReturn: false, canConfirm: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await fetchWageStatementCapabilities();
    await fetchWageStatementWorkbench();
    await fetchWageStatementSummary("statement / 1");
    await fetchWageStatementImportPreview("statement / 1");

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/wage-statements/capabilities");
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/wage-statements/workbench");
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/wage-statements/statement%20%2F%201/summary"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      4,
      "/wage-statements/statement%20%2F%201/import-preview"
    );
  });

  it("posts opaque approved-source input and revision-bound lifecycle commands through the domain API", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "source-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ statementId: "statement-1", revision: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ statementId: "statement-1", revision: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ statementId: "statement-1", revision: 2 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ statementId: "statement-1", revision: 2 }), { status: 201 }));

    await createApprovedWageSource({ externalReference: "approved-batch" });
    await createWageStatementDraft({ sourceVersionId: "source / 1" });
    await submitWageStatement("statement / 1", { idempotencyKey: "submit-key", expectedRevision: 1 });
    await returnWageStatement("statement / 1", { idempotencyKey: "return-key", expectedRevision: 1, reason: "请补充来源说明" });
    await confirmWageStatement("statement / 1", { idempotencyKey: "confirm-key", expectedRevision: 2 });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/wage-statements/approved-sources", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalReference: "approved-batch" })
    }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/wage-statements/drafts", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sourceVersionId: "source / 1" })
    }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(3, "/wage-statements/statement%20%2F%201/submit", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(4, "/wage-statements/statement%20%2F%201/return", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(5, "/wage-statements/statement%20%2F%201/confirm", expect.objectContaining({ method: "POST" }));
  });

  it("keeps an explicit lifecycle business-rejection HTTP status for the page retry policy", async () => {
    mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "版本已更新" }), { status: 409 }));

    const rejection = submitWageStatement("statement-1", { idempotencyKey: "submit-key", expectedRevision: 1 });
    await expect(rejection).rejects.toMatchObject({
      name: "WageStatementApiError",
      status: 409,
      message: "版本已更新"
    });
    await expect(rejection).rejects.toBeInstanceOf(WageStatementApiError);
  });
});

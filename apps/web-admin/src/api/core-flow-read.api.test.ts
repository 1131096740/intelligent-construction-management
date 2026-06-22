import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchContractDetail,
  fetchPaymentDetail,
  fetchSettlementDetail,
  recordPaymentExecution,
  recordPaymentFinance,
  recordPaymentPdfArchive,
  reviewPaymentApproval
} from "./core-flow-read.api";

describe("core flow read API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the first read-only detail endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await fetchContractDetail("HT-2026-001");
    await fetchSettlementDetail("JS-2026-018");
    await fetchPaymentDetail("FK-2026-006");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/HT-2026-001",
      "/api/settlements/JS-2026-018",
      "/api/payments/FK-2026-006"
    ]);
  });

  it("posts payment workflow actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await reviewPaymentApproval("FK-2026-006", {
      decision: "approve",
      approvedAmountCents: 5000000,
      reviewedByUserId: "chairman-1"
    });
    await recordPaymentExecution("FK-2026-006", {
      amountCents: 5000000,
      paidAt: "2026-06-22T00:00:00.000Z",
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    });
    await recordPaymentFinance("FK-2026-006", {
      amountCents: 5000000,
      occurredAt: "2026-06-22T01:00:00.000Z",
      createdByUserId: "finance-1"
    });
    await recordPaymentPdfArchive("FK-2026-006", {
      fileId: "file-2",
      archivedByUserId: "finance-1"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/payments/FK-2026-006/approval",
      "/api/payments/FK-2026-006/executions",
      "/api/payments/FK-2026-006/finance-records",
      "/api/payments/FK-2026-006/pdf-archive"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        approvedAmountCents: 5000000,
        reviewedByUserId: "chairman-1"
      })
    );
  });
});

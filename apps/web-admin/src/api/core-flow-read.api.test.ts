import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchContractDetail,
  fetchPaymentDetail,
  fetchSettlementDetail,
  confirmContractArchive,
  confirmSettlementArchive,
  createFileDownloadTicket,
  uploadContractArchiveFile,
  uploadPrivateFile,
  uploadSettlementArchiveFile,
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

  it("posts contract and settlement archive actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await uploadContractArchiveFile("contract-version-1", {
      fileId: "file-contract-archive",
      uploadedByUserId: "contract-staff-1"
    });
    await confirmContractArchive("contract-version-1", {
      archiveFileId: "contract-archive-file-1",
      confirmedByUserId: "contract-director-1"
    });
    await uploadSettlementArchiveFile("settlement-1", {
      fileId: "file-settlement-archive",
      uploadedByUserId: "contract-staff-1"
    });
    await confirmSettlementArchive("settlement-1", {
      archiveFileId: "settlement-archive-file-1",
      confirmedByUserId: "contract-director-1"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/contract-version-1/archive-files",
      "/api/contracts/contract-version-1/archive-confirmation",
      "/api/settlements/settlement-1/archive-files",
      "/api/settlements/settlement-1/archive-confirmation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        fileId: "file-contract-archive",
        uploadedByUserId: "contract-staff-1"
      })
    );
  });

  it("uploads private files and requests short-lived download tickets through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "file-1" })
    } as Response);

    await uploadPrivateFile(new Blob(["file"]), {
      fileName: "盖章合同.pdf",
      uploadedByUserId: "contract-staff-1"
    });
    await createFileDownloadTicket("file-1", {
      actorUserId: "finance-1"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/files",
      "/api/files/file-1/download-ticket?actorUserId=finance-1"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[1][1]).toBeUndefined();
  });
});

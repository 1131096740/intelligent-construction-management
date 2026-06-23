import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchContractDetail,
  fetchPaymentDetail,
  fetchSettlementDetail,
  createPrivateFileDownloadTicket,
  confirmContractArchive,
  confirmSettlementArchive,
  delegateContractApproval,
  delegatePaymentApproval,
  generateContractPdfArchive,
  generatePaymentPdfArchive,
  generateSettlementPdfArchive,
  approveContractSeal,
  reviewContractApproval,
  reviewSettlementApproval,
  submitContractApproval,
  uploadContractArchiveFile,
  uploadPrivateFile,
  uploadSettlementArchiveFile,
  recordPaymentExecution,
  recordPaymentFinance,
  recordPaymentPdfArchive,
  reviewPaymentApproval,
  withdrawSettlementApproval,
  transferSettlementApproval,
  delegateSettlementApproval,
  transferContractApproval,
  transferPaymentApproval,
  listApprovalDelegations,
  createApprovalDelegation,
  revokeApprovalDelegation
} from "./core-flow-read.api";

describe("core flow read API client", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

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
      approvedAmountCents: 5000000
    });
    await transferPaymentApproval("FK-2026-006", {
      toUserId: "payment-transfer-user"
    });
    await delegatePaymentApproval("FK-2026-006", {
      toUserId: "payment-delegate-user"
    });
    await recordPaymentExecution("FK-2026-006", {
      amountCents: 5000000,
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });
    await recordPaymentFinance("FK-2026-006", {
      amountCents: 5000000,
      occurredAt: "2026-06-22T01:00:00.000Z"
    });
    await recordPaymentPdfArchive("FK-2026-006", {
      fileId: "file-2"
    });
    await generatePaymentPdfArchive("FK-2026-006");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/payments/FK-2026-006/approval",
      "/api/payments/FK-2026-006/approval-transfer",
      "/api/payments/FK-2026-006/approval-delegation",
      "/api/payments/FK-2026-006/executions",
      "/api/payments/FK-2026-006/finance-records",
      "/api/payments/FK-2026-006/pdf-archive",
      "/api/payments/FK-2026-006/pdf-generation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        approvedAmountCents: 5000000
      })
    );
  });

  it("posts contract and settlement archive actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await uploadContractArchiveFile("contract-version-1", {
      fileId: "file-contract-archive"
    });
    await confirmContractArchive("contract-version-1", {
      archiveFileId: "contract-archive-file-1",
      confirmationPassword: "current-password"
    });
    await generateContractPdfArchive("contract-version-1");
    await uploadSettlementArchiveFile("settlement-1", {
      fileId: "file-settlement-archive"
    });
    await confirmSettlementArchive("settlement-1", {
      archiveFileId: "settlement-archive-file-1",
      confirmationPassword: "current-password"
    });
    await generateSettlementPdfArchive("settlement-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/contract-version-1/archive-files",
      "/api/contracts/contract-version-1/archive-confirmation",
      "/api/contracts/contract-version-1/pdf-generation",
      "/api/settlements/settlement-1/archive-files",
      "/api/settlements/settlement-1/archive-confirmation",
      "/api/settlements/settlement-1/pdf-generation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        fileId: "file-contract-archive"
      })
    );
  });

  it("posts contract and settlement approval actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await submitContractApproval("contract-version-1");
    await reviewContractApproval("contract-version-1", {
      decision: "approve"
    });
    await transferContractApproval("contract-version-1", {
      toUserId: "contract-transfer-user"
    });
    await delegateContractApproval("contract-version-1", {
      toUserId: "contract-delegate-user"
    });
    await approveContractSeal("contract-version-1");
    await reviewSettlementApproval("settlement-1", {
      decision: "approve"
    });
    await withdrawSettlementApproval("settlement-1");
    await transferSettlementApproval("settlement-1", {
      toUserId: "delegate-user-1"
    });
    await delegateSettlementApproval("settlement-1", {
      toUserId: "agent-user-1"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/contract-version-1/approval-submission",
      "/api/contracts/contract-version-1/approval",
      "/api/contracts/contract-version-1/approval-transfer",
      "/api/contracts/contract-version-1/approval-delegation",
      "/api/contracts/contract-version-1/seal-approval",
      "/api/settlements/settlement-1/approval",
      "/api/settlements/settlement-1/approval-withdrawal",
      "/api/settlements/settlement-1/approval-transfer",
      "/api/settlements/settlement-1/approval-delegation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        decision: "approve"
      })
    );
  });

  it("uploads private files through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "file-1" })
    } as Response);

    await uploadPrivateFile(new Blob(["file"]), "盖章合同.pdf");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/files"]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("requests private file download tickets through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ downloadUrl: "/files/file-1/download?token=t" })
    } as Response);

    await createPrivateFileDownloadTicket("file-1", {
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/files/file-1/download-ticket"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password" })
    );
  });

  it("manages approval delegations through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "delegation-1" })
    } as Response);

    await listApprovalDelegations();
    await createApprovalDelegation({
      toUserId: "user-b",
      startsAt: "2026-06-23T00:00:00.000Z",
      endsAt: "2026-07-23T00:00:00.000Z"
    });
    await revokeApprovalDelegation("delegation-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/approval-delegations",
      "/api/approval-delegations",
      "/api/approval-delegations/delegation-1"
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      undefined,
      "POST",
      "DELETE"
    ]);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        toUserId: "user-b",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z"
      })
    );
  });
});

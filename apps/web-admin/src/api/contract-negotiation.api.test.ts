import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeContractNegotiationRound,
  disposeContractDocumentDifference,
  listContractOfflineRevisionHistory,
  listContractNegotiationRounds,
  openContractNegotiationRound,
  openContractRevisionPreview,
  retryContractOfflineRevision,
  uploadContractNegotiationRevision
} from "./contract-negotiation.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("contract negotiation API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockApiFetch.mockReset();
    vi.stubGlobal("window", {
      open: vi.fn(),
      setTimeout: vi.fn()
    });
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })
    );
  });

  it("uses encoded round, revision and difference resources", async () => {
    await listContractNegotiationRounds("version/1");
    await openContractNegotiationRound("version/1", " 第一轮 ");
    await closeContractNegotiationRound("round/1");
    await retryContractOfflineRevision("revision/1");
    await disposeContractDocumentDifference("difference/1", {
      disposition: "rejected",
      reason: "与商务共识不符"
    });

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/contract-workbench/version%2F1/negotiation-rounds",
      "/contract-workbench/version%2F1/negotiation-rounds",
      "/contract-negotiation-rounds/round%2F1/close",
      "/contract-offline-revisions/revision%2F1/retry",
      "/contract-document-differences/difference%2F1/disposition"
    ]);
    expect(mockApiFetch.mock.calls[1][1]?.body).toBe(JSON.stringify({ note: "第一轮" }));
  });

  it("lists a strict read-only offline revision history without exposing comparison internals", async () => {
    mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        id: "legacy-revision-1",
        label: "旧流程修订稿",
        note: "上线前留存",
        status: "succeeded",
        hasPreviewPdf: false,
        errorMessage: null,
        createdAt: "2026-07-11T09:00:00.000Z",
        completedAt: "2026-07-11T09:01:00.000Z",
        comparison: null,
        negotiationRound: null
      },
      {
        id: "governed-revision-1",
        label: "第一轮修订稿",
        note: null,
        status: "succeeded",
        hasPreviewPdf: true,
        errorMessage: null,
        createdAt: "2026-07-12T09:00:00.000Z",
        completedAt: "2026-07-12T09:01:00.000Z",
        comparison: {
          id: "comparison-1",
          status: "succeeded",
          algorithmVersion: "contract-docx-patience-v1",
          errorMessage: null,
          completedAt: "2026-07-12T09:01:00.000Z",
          differences: [
            {
              id: "difference-1",
              sortOrder: 1,
              changeType: "replace",
              kind: "paragraph",
              locationPath: "正文/第3段",
              basePath: "p3",
              revisedPath: "p3",
              beforeText: "原内容",
              afterText: "修订内容",
              candidate: {
                kind: "key_clause",
                clauseKey: "payment",
                title: "付款条款",
                proposedText: "修订内容",
                baseTextSha256: "a".repeat(64)
              },
              disposition: "pending",
              dispositionReason: null,
              disposedAt: null
            }
          ]
        },
        negotiationRound: {
          id: "round-1",
          roundNo: 1,
          status: "open",
          sourceRevision: 3
        }
      }
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(listContractOfflineRevisionHistory("version/1")).resolves.toEqual([
      {
        id: "legacy-revision-1",
        label: "旧流程修订稿",
        note: "上线前留存",
        status: "succeeded",
        hasPreviewPdf: false,
        errorMessage: null,
        createdAt: "2026-07-11T09:00:00.000Z",
        completedAt: "2026-07-11T09:01:00.000Z",
        negotiationRound: null
      },
      {
        id: "governed-revision-1",
        label: "第一轮修订稿",
        note: null,
        status: "succeeded",
        hasPreviewPdf: true,
        errorMessage: null,
        createdAt: "2026-07-12T09:00:00.000Z",
        completedAt: "2026-07-12T09:01:00.000Z",
        negotiationRound: {
          id: "round-1",
          roundNo: 1,
          status: "open",
          sourceRevision: 3
        }
      }
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-workbench/version%2F1/offline-revisions"
    );
  });

  it("fails closed on duplicate, sensitive or undeclared offline revision history fields", async () => {
    const legacy = {
      id: "legacy-revision-1",
      label: "旧流程修订稿",
      note: null,
      status: "succeeded",
      hasPreviewPdf: false,
      errorMessage: null,
      createdAt: "2026-07-11T09:00:00.000Z",
      completedAt: "2026-07-11T09:01:00.000Z",
      comparison: null,
      negotiationRound: null
    };
    for (const invalid of [
      [legacy, legacy],
      [{ ...legacy, fileId: "private-file" }],
      [{ ...legacy, undeclared: true }],
      [{ ...legacy, comparison: { id: "comparison-injected" } }],
      [{ ...legacy, hasPreviewPdf: true }],
      [{
        ...legacy,
        negotiationRound: {
          id: "round-1",
          roundNo: 1,
          status: "open",
          sourceRevision: 3,
          openedByUserId: "private-actor"
        }
      }]
    ]) {
      mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify(invalid), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
      await expect(listContractOfflineRevisionHistory("version-1")).rejects.toThrow(
        /格式不正确|重复/u
      );
    }
  });

  it("uploads only the user file and confirmation without accepting source ids", async () => {
    await uploadContractNegotiationRevision("version-1", {
      fileId: "file-1",
      label: "业主修订稿",
      confirmationStatementAccepted: true
    });

    const body = JSON.parse(String(mockApiFetch.mock.calls[0][1]?.body));
    expect(body).toEqual({
      fileId: "file-1",
      label: "业主修订稿",
      confirmationStatementAccepted: true
    });
    expect(body).not.toHaveProperty("sourceGeneratedDocumentId");
    expect(body).not.toHaveProperty("sourceRevision");
  });

  it("opens revision previews only through a normalized same-origin file ticket and authenticated blob", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        fileName: "修订稿.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
        expiresAt: "2026-07-12T10:05:00.000Z",
        downloadUrl: "/files/download-tickets/ticket-1?token=safe"
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response("%PDF-1.4", {
        status: 200,
        headers: { "Content-Type": "application/pdf" }
      }));
    const createObjectUrl = vi.fn().mockReturnValue("blob:revision-preview");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    const open = vi.mocked(window.open);

    await expect(openContractRevisionPreview("revision/1", {
      confirmationPassword: "current-password",
      downloadReason: "复核磋商差异"
    }, () => true)).resolves.toBe(true);

    expect(mockApiFetch).toHaveBeenNthCalledWith(1,
      "/contract-offline-revisions/revision%2F1/preview-download-ticket",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          confirmationPassword: "current-password",
          downloadReason: "复核磋商差异"
        })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/files/download-tickets/ticket-1?token=safe");
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("blob:revision-preview", "_blank", "noopener,noreferrer");
  });

  it.each([
    "https://evil.example/files/ticket-1",
    "//evil.example/files/ticket-1",
    "javascript:alert(1)",
    "/revision-preview-ticket",
    "/files/../admin",
    "/files/ticket-1#fragment",
    "/files\\evil"
  ])("rejects an unsafe revision preview ticket path: %s", async (downloadUrl) => {
    mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      fileName: "修订稿.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
      expiresAt: "2026-07-12T10:05:00.000Z",
      downloadUrl
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(openContractRevisionPreview("revision-1", {
      confirmationPassword: "password",
      downloadReason: "复核差异"
    }, () => true)).rejects.toThrow("票据地址不安全");
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch or open a ticket after its revision selection becomes stale", async () => {
    mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      fileName: "修订稿.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
      expiresAt: "2026-07-12T10:05:00.000Z",
      downloadUrl: "/files/download-tickets/ticket-1"
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const open = vi.mocked(window.open);

    await expect(openContractRevisionPreview("revision-1", {
      confirmationPassword: "password",
      downloadReason: "复核差异"
    }, () => false)).resolves.toBe(false);

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});

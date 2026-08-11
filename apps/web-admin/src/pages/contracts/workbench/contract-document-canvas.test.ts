import { describe, expect, it } from "vitest";
import { contractDocumentCanvasState } from "./contract-document-canvas";

describe("contract document canvas state", () => {
  const fingerprint = "a".repeat(64);

  it("selects the latest successful PDF for the current document content", () => {
    const state = contractDocumentCanvasState(
      [
        {
          id: "older-current",
          purpose: "draft",
          status: "success",
          sourceRevision: 4,
          documentContentRevision: 2,
          documentContentFingerprint: fingerprint,
          pdfFileId: "pdf-older-current",
          completedAt: "2026-07-12T08:00:00.000Z"
        },
        {
          id: "newer-old-revision",
          purpose: "internal_review",
          status: "success",
          sourceRevision: 3,
          documentContentRevision: 1,
          documentContentFingerprint: "b".repeat(64),
          pdfFileId: "pdf-newer-old-revision",
          completedAt: "2026-07-12T10:00:00.000Z"
        },
        {
          id: "latest-current",
          purpose: "negotiation",
          status: "success",
          sourceRevision: 3,
          documentContentRevision: 2,
          documentContentFingerprint: fingerprint,
          pdfFileId: "pdf-latest-current",
          completedAt: "2026-07-12T09:00:00.000Z"
        },
        {
          id: "no-pdf",
          purpose: "draft",
          status: "success",
          sourceRevision: 4,
          documentContentRevision: 2,
          documentContentFingerprint: fingerprint,
          completedAt: "2026-07-12T11:00:00.000Z"
        }
      ],
      2,
      fingerprint
    );

    expect(state.kind).toBe("ready");
    expect(state.document?.id).toBe("latest-current");
    expect(state.document?.pdfFileId).toBe("pdf-latest-current");
  });

  it("selects a successful external-purpose document for current content", () => {
    const state = contractDocumentCanvasState(
      [
        {
          id: "outgoing",
          purpose: "external",
          status: "success",
          sourceRevision: 4,
          documentContentRevision: 2,
          documentContentFingerprint: fingerprint,
          pdfFileId: "pdf-outgoing",
          completedAt: "2026-07-12T08:00:00.000Z"
        },
        {
          id: "older-draft",
          purpose: "draft",
          status: "success",
          sourceRevision: 3,
          documentContentRevision: 1,
          documentContentFingerprint: "b".repeat(64),
          pdfFileId: "pdf-older-draft",
          completedAt: "2026-07-12T06:00:00.000Z"
        }
      ],
      2,
      fingerprint
    );

    expect(state.kind).toBe("ready");
    expect(state.document?.id).toBe("outgoing");
    expect(state.document?.pdfFileId).toBe("pdf-outgoing");
  });

  it("reports an outdated canvas instead of presenting an old PDF as current", () => {
    const state = contractDocumentCanvasState(
      [
        {
          id: "stale",
          purpose: "draft",
          status: "stale",
          sourceRevision: 2,
          documentContentRevision: 1,
          documentContentFingerprint: "b".repeat(64),
          pdfFileId: "pdf-stale",
          createdAt: "2026-07-12T08:00:00.000Z"
        }
      ],
      2,
      fingerprint
    );

    expect(state.kind).toBe("outdated");
    expect(state.document?.id).toBe("stale");
  });

  it("distinguishes a current generation job from a truly empty canvas", () => {
    expect(
      contractDocumentCanvasState(
        [{
          id: "queued",
          status: "queued",
          sourceRevision: 5,
          documentContentRevision: 2,
          documentContentFingerprint: fingerprint
        }],
        2,
        fingerprint
      ).kind
    ).toBe("processing");
    expect(contractDocumentCanvasState([], 2, fingerprint).kind).toBe("empty");
  });
});

import { describe, expect, it } from "vitest";
import {
  canApplyContractNegotiationResponse,
  canApplyContractNegotiationSelectionResponse,
  canCloseContractNegotiationRound,
  contractDifferenceCandidatePresentation,
  contractDifferenceDispositionDisabledReason,
  contractNegotiationSelectionKey,
  contractNegotiationReadinessMessages,
  hasActiveContractNegotiationProcessing,
  normalizeContractNegotiationRounds,
  reconcileContractNegotiationSelection
} from "./contract-negotiation.state";

function payload(disposition = "pending", processStatus = "succeeded") {
  return [
    {
      id: "round-1",
      roundNo: 1,
      status: "open",
      sourceRevision: 3,
      note: "首轮",
      openedAt: "2026-07-12T08:00:00.000Z",
      closedAt: null,
      revisions: [
        {
          id: "revision-1",
          label: "业主修订稿",
          note: null,
          status: processStatus,
          hasPreviewPdf: processStatus === "succeeded",
          errorMessage: null,
          createdAt: "2026-07-12T09:00:00.000Z",
          completedAt: "2026-07-12T09:01:00.000Z",
          comparison: {
            id: "comparison-1",
            status: processStatus,
            algorithmVersion: "v1",
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
                beforeText: "合同金额：100元",
                afterText: "合同金额：120元",
                candidate: { kind: "amount", label: "合同金额", cents: "12000" },
                disposition,
                dispositionReason: null,
                disposedAt: null
              }
            ]
          }
        }
      ]
    }
  ];
}

describe("contract negotiation state", () => {
  it("normalizes the safe nested read model and rejects raw file fields or duplicates", () => {
    const rounds = normalizeContractNegotiationRounds(payload());
    expect(rounds[0].revisions[0].hasPreviewPdf).toBe(true);
    const comparison = rounds[0].revisions[0].comparison!;
    expect(comparison).not.toHaveProperty("algorithmVersion");
    expect(comparison.differences[0]).not.toHaveProperty("basePath");
    expect(comparison.differences[0]).not.toHaveProperty("revisedPath");
    expect(() =>
      normalizeContractNegotiationRounds([
        { ...payload()[0], revisions: [{ ...payload()[0].revisions[0], previewPdfFileId: "secret" }] }
      ])
    ).toThrow("格式不正确");
    expect(() => normalizeContractNegotiationRounds([...payload(), ...payload()])).toThrow("重复");
  });

  it("projects public candidates to display-only fields", () => {
    const source = payload();
    const comparison = source[0].revisions[0].comparison as unknown as {
      differences: Array<Record<string, unknown>>;
    };
    comparison.differences = [
      {
        ...comparison.differences[0],
        id: "difference-clause",
        candidate: {
          kind: "key_clause",
          clauseKey: "payment_terms",
          title: "付款条款",
          proposedText: "归档后30天付款",
          baseTextSha256: "internal-hash"
        }
      },
      {
        ...comparison.differences[0],
        id: "difference-date",
        sortOrder: 2,
        candidate: {
          kind: "date",
          fieldKey: "signed_at",
          label: "签约日期",
          isoDate: "2026-07-12"
        }
      }
    ];

    const candidates = normalizeContractNegotiationRounds(source)[0]
      .revisions[0].comparison!.differences.map((difference) => difference.candidate);
    expect(candidates).toEqual([
      { kind: "key_clause", title: "付款条款", proposedText: "归档后30天付款" },
      { kind: "date", label: "签约日期", isoDate: "2026-07-12" }
    ]);
    expect(JSON.stringify(candidates)).not.toMatch(/clauseKey|baseTextSha256|fieldKey/u);
  });

  it("preserves a valid selection and falls back to the newest revision", () => {
    const rounds = normalizeContractNegotiationRounds(payload());
    expect(reconcileContractNegotiationSelection(rounds, null)).toEqual({
      roundId: "round-1",
      revisionId: "revision-1"
    });
    expect(
      reconcileContractNegotiationSelection(rounds, { roundId: "round-1", revisionId: "missing" })
    ).toEqual({ roundId: "round-1", revisionId: "revision-1" });
  });

  it("blocks closing until comparisons finish and every difference is disposed", () => {
    expect(canCloseContractNegotiationRound(normalizeContractNegotiationRounds(payload())[0])).toBe(false);
    expect(
      canCloseContractNegotiationRound(normalizeContractNegotiationRounds(payload("rejected"))[0])
    ).toBe(true);
    expect(hasActiveContractNegotiationProcessing(normalizeContractNegotiationRounds(payload("pending", "processing")))).toBe(true);
  });

  it("keeps candidates human-readable and disposition reasons fail closed", () => {
    expect(contractDifferenceCandidatePresentation({ kind: "amount", label: "合同金额", cents: "12000" })).toEqual({
      title: "合同金额",
      value: "¥120.00"
    });
    expect(contractDifferenceDispositionDisabledReason("rejected", "")).toBe("请填写处置原因。");
    expect(contractDifferenceDispositionDisabledReason("confirmed", "")).toBe("");
  });

  it("filters negotiation readiness and rejects stale contract-version responses", () => {
    expect(
      contractNegotiationReadinessMessages({
        blocking: [
          { key: "negotiation.pending_difference", message: "仍有待处理差异" },
          { key: "party.missing", message: "缺少主体" }
        ]
      })
    ).toEqual(["仍有待处理差异"]);
    expect(canApplyContractNegotiationResponse(2, 2, "v1", "v1")).toBe(true);
    expect(canApplyContractNegotiationResponse(1, 2, "v1", "v1")).toBe(false);
    expect(canApplyContractNegotiationResponse(2, 2, "v1", "v2")).toBe(false);
    const selected = { round: { id: "round-1" }, revision: { id: "revision-1" } };
    expect(contractNegotiationSelectionKey(selected)).toBe("round-1:revision-1");
    expect(canApplyContractNegotiationSelectionResponse(3, 3, "round-1:revision-1", "round-1:revision-1")).toBe(true);
    expect(canApplyContractNegotiationSelectionResponse(2, 3, "round-1:revision-1", "round-1:revision-1")).toBe(false);
    expect(canApplyContractNegotiationSelectionResponse(3, 3, "round-1:revision-1", "round-1:revision-2")).toBe(false);
  });
});

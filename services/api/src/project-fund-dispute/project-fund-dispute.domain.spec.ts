import { BadRequestException, ConflictException } from "@nestjs/common";

import {
  assertProjectFundDisputeDraft,
  assertProjectFundDisputeTransition,
  buildProjectFundDisputeFingerprint,
  buildProjectFundDisputeIdentity,
  sha256Jcs
} from "./project-fund-dispute.domain";

describe("project fund dispute domain", () => {
  const draft = {
    projectId: "project-1",
    businessCode: "争议资金-001",
    affiliateAssignmentId: "assignment-1",
    fundHolderKind: "participating_company" as const,
    fundHolderId: "company-1",
    disputeKind: "upstream" as const,
    counterpartyKind: "owner",
    counterpartyId: "owner-1",
    counterpartyNameSnapshot: "业主单位甲",
    basisKind: "written_evidence",
    basisBusinessIdOrEvidenceSha256: "b".repeat(64),
    referenceCode: "CASE-2026-001",
    entryKind: "establish" as const,
    amountCents: "120000",
    occurredAt: "2026-09-01",
    evidenceLevel: "B" as const,
    evidenceFileId: "file-1",
    evidenceSha256: "c".repeat(64),
    disputeSummary: "已收工程款因上游权属争议暂不可使用",
    idempotencyKey: "9d7d5846-e391-4e14-8d7d-2d1d9227d164"
  };

  it("accepts an A/B positive CNY draft and produces a stable frozen fingerprint", () => {
    const validated = assertProjectFundDisputeDraft(draft);
    expect(validated.amountCents).toBe(120000n);
    expect(buildProjectFundDisputeFingerprint(validated)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("builds a stable cross-source identity with strict JCS rules", () => {
    const first = buildProjectFundDisputeIdentity({
      projectId: " project-1 ",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "participating_company",
      fundHolderId: "company-1",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: "a".repeat(64),
      currencyCode: "CNY"
    });
    const second = buildProjectFundDisputeIdentity({
      projectId: "project-1",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "participating_company",
      fundHolderId: "company-1",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: "a".repeat(64),
      currencyCode: "CNY"
    });

    expect(first).toEqual(second);
    expect(first.economicIdentityKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.sourceIdentityKey).not.toBe(first.economicIdentityKey);
    expect(sha256Jcs({ b: 2, a: 1 })).toBe(sha256Jcs({ a: 1, b: 2 }));
    expect(() => sha256Jcs(Number.POSITIVE_INFINITY)).toThrow("非有限数");
    const sparse: unknown[] = [];
    sparse[1] = "gap";
    expect(() => sha256Jcs(sparse)).toThrow("数组空洞");
    expect(() => sha256Jcs("\ud800")).toThrow("lone surrogate");
  });

  it("rejects C-grade money and non-positive dispute amounts", () => {
    expect(() => assertProjectFundDisputeDraft({ ...draft, evidenceLevel: "C" as never }))
      .toThrow(BadRequestException);
    expect(() => assertProjectFundDisputeDraft({ ...draft, amountCents: "0" }))
      .toThrow(BadRequestException);
  });

  it("requires a new dispute to begin with an establish entry", () => {
    expect(() => assertProjectFundDisputeDraft({
      ...draft,
      entryKind: "increase"
    })).toThrow("争议资金首笔分录必须先建立争议");
  });

  it("enforces independent project-manager or contract-director attestation before finance confirmation", () => {
    expect(() => assertProjectFundDisputeTransition({
      action: "attest",
      status: "submitted",
      preparedByUserId: "same-user",
      actorUserId: "same-user",
      actorRoles: ["project_manager"],
      fingerprint: "d".repeat(64),
      expectedFingerprint: "d".repeat(64)
    })).toThrow(ConflictException);

    expect(assertProjectFundDisputeTransition({
      action: "attest",
      status: "submitted",
      preparedByUserId: "finance-1",
      actorUserId: "contract-director-1",
      actorRoles: ["contract_director"],
      fingerprint: "d".repeat(64),
      expectedFingerprint: "d".repeat(64)
    })).toBe("attested");

    expect(() => assertProjectFundDisputeTransition({
      action: "confirm",
      status: "submitted",
      preparedByUserId: "finance-1",
      actorUserId: "finance-director-1",
      actorRoles: ["finance_director"],
      fingerprint: "d".repeat(64),
      expectedFingerprint: "d".repeat(64)
    })).toThrow(ConflictException);
  });
});

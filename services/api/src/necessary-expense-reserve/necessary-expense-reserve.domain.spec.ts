import { BadRequestException, ConflictException } from "@nestjs/common";

import {
  assertNecessaryExpenseReserveDraft,
  assertNecessaryExpenseReserveTransition,
  buildNecessaryExpenseReserveFingerprint,
  buildNecessaryExpenseReserveIdentity,
  sha256Jcs
} from "./necessary-expense-reserve.domain";

describe("necessary expense reserve domain", () => {
  const draft = {
    projectId: "project-1",
    businessCode: "必要准备-001",
    affiliateAssignmentId: "assignment-1",
    fundHolderKind: "participating_company" as const,
    fundHolderId: "company-1",
    reasonKind: "mandatory_closeout" as const,
    title: "项目收尾资料整理",
    basisKind: "written_evidence",
    basisBusinessIdOrEvidenceSha256: "b".repeat(64),
    basisSummary: "经确认仍需完成的法定收尾资料",
    entryKind: "establish" as const,
    amountCents: "120000",
    occurredAt: "2026-09-01",
    evidenceLevel: "B" as const,
    evidenceFileId: "file-1",
    evidenceSha256: "c".repeat(64),
    reason: "首次建立必要准备",
    idempotencyKey: "9d7d5846-e391-4e14-8d7d-2d1d9227d164"
  };

  it("accepts an A/B positive CNY draft and produces a stable frozen fingerprint", () => {
    const validated = assertNecessaryExpenseReserveDraft(draft);
    expect(validated.amountCents).toBe(120000n);
    expect(buildNecessaryExpenseReserveFingerprint(validated)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("builds a stable cross-source identity with strict JCS rules", () => {
    const first = buildNecessaryExpenseReserveIdentity({
      projectId: " project-1 ",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "participating_company",
      fundHolderId: "company-1",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: "a".repeat(64),
      currencyCode: "CNY"
    });
    const second = buildNecessaryExpenseReserveIdentity({
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

  it("rejects C-grade money and non-positive reserve amounts", () => {
    expect(() => assertNecessaryExpenseReserveDraft({ ...draft, evidenceLevel: "C" as never }))
      .toThrow(BadRequestException);
    expect(() => assertNecessaryExpenseReserveDraft({ ...draft, amountCents: "0" }))
      .toThrow(BadRequestException);
  });

  it("enforces independent project-manager attestation before finance confirmation", () => {
    expect(() => assertNecessaryExpenseReserveTransition({
      action: "attest",
      status: "submitted",
      preparedByUserId: "same-user",
      actorUserId: "same-user",
      actorRoles: ["project_manager"],
      fingerprint: "d".repeat(64),
      expectedFingerprint: "d".repeat(64)
    })).toThrow(ConflictException);

    expect(() => assertNecessaryExpenseReserveTransition({
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

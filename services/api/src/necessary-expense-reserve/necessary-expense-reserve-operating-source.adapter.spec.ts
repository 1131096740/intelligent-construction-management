import { NecessaryExpenseReserveOperatingSourceAdapter } from "./necessary-expense-reserve-operating-source.adapter";

describe("NecessaryExpenseReserveOperatingSourceAdapter", () => {
  it("maps a confirmed establish entry to one cash restriction impact only", () => {
    const adapter = new NecessaryExpenseReserveOperatingSourceAdapter();
    const mapped = adapter.toOperatingFactInput({
      projectId: "project-1",
      sourceType: "project_necessary_expense_reserve_entry",
      sourceBusinessId: "entry-1",
      sourceBusinessCode: "必要准备-001",
      sourceVersion: 2,
      status: "confirmed",
      sourceSnapshot: {
        schema: "project_necessary_expense_reserve_entry/V1",
        reserveId: "reserve-1",
        entryId: "entry-1",
        entryKind: "establish",
        amountCents: "120000",
        occurredAt: "2026-09-01T00:00:00.000Z",
        operatingLedgerEffectiveDate: "2026-08-01T00:00:00.000Z",
        confirmedAt: "2026-09-10T00:00:00.000Z",
        evidenceLevel: "B",
        evidenceFileId: "file-1",
        evidenceSha256: "c".repeat(64),
        fingerprint: "d".repeat(64),
        economicIdentityKey: "e".repeat(64),
        sourceIdentityKey: "f".repeat(64),
        idempotencyKey: "9d7d5846-e391-4e14-8d7d-2d1d9227d164",
        confirmedByUserId: "finance-director-1",
        affiliate: {
          assignmentId: "assignment-1",
          businessPartyVersionId: "affiliate-version-1",
          name: "施工企业甲"
        },
        fundHolder: { kind: "participating_company", id: "company-1" }
      }
    });

    expect(mapped.entryKind).toBe("original");
    expect(mapped.input.factKind).toBe("project_cash_restriction");
    expect(mapped.input.direction).toBe("neutral");
    expect(mapped.input.subjects).toEqual({});
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "necessary_expense_reserve_increase",
        direction: "increase",
        subjectRole: "fund_holder",
        subject: { kind: "participating_company", id: "company-1" }
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ impactKind: "confirmed_cost" }),
      expect.objectContaining({ impactKind: "payable_increase" })
    ]));
  });

  it("maps release as a decrease and technical reversal as an exact reversal", () => {
    const adapter = new NecessaryExpenseReserveOperatingSourceAdapter();
    const base = {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "entry-2",
      sourceBusinessCode: "必要准备-001",
      sourceVersion: 3,
      status: "confirmed" as const,
      sourceSnapshot: {
        schema: "project_necessary_expense_reserve_entry/V1",
        reserveId: "reserve-1",
        entryId: "entry-2",
        entryKind: "release",
        adjustsEntryId: "entry-1",
        amountCents: "20000",
        occurredAt: "2026-09-05T00:00:00.000Z",
        operatingLedgerEffectiveDate: "2026-08-01T00:00:00.000Z",
        confirmedAt: "2026-09-10T00:00:00.000Z",
        evidenceLevel: "A",
        evidenceFileId: "file-2",
        evidenceSha256: "c".repeat(64),
        fingerprint: "d".repeat(64),
        economicIdentityKey: "e".repeat(64),
        sourceIdentityKey: "f".repeat(64),
        idempotencyKey: "9d7d5846-e391-4e14-8d7d-2d1d9227d164",
        confirmedByUserId: "finance-director-1",
        affiliate: { assignmentId: "assignment-1", businessPartyVersionId: "affiliate-version-1", name: "施工企业甲" },
        fundHolder: { kind: "construction_enterprise", id: "affiliate-version-1" }
      }
    };

    expect(adapter.toOperatingFactInput(base).input.impacts[0]).toEqual(expect.objectContaining({
      impactKind: "necessary_expense_reserve_decrease",
      direction: "decrease"
    }));
    expect(adapter.toOperatingFactInput({
      ...base,
      sourceSnapshot: {
        ...base.sourceSnapshot,
        entryKind: "technical_reversal",
        amountCents: "120000",
        adjustsEntryKind: "establish",
        adjustsEntryFingerprint: "1".repeat(64)
      }
    })).toEqual(expect.objectContaining({
      entryKind: "reversal",
      input: expect.objectContaining({
        adjustsFactId: "entry-1",
        impacts: [expect.objectContaining({
          sourceImpactKey: "establish:cash-restriction",
          impactKind: "necessary_expense_reserve_increase",
          direction: "decrease",
          impactSnapshot: {
            reserveId: "reserve-1",
            entryId: "entry-1",
            fingerprint: "1".repeat(64),
            economicIdentityKey: "e".repeat(64),
            sourceIdentityKey: "f".repeat(64)
          }
        })]
      })
    }));
  });
});

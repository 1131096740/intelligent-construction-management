import { ConflictException } from "@nestjs/common";

import {
  assertClearingActorsDisjoint,
  buildClearingConfirmationPlan,
  fingerprintClearingCommand
} from "./clearing-domain";

describe("clearing confirmation domain", () => {
  it("consumes only explicit withheld allocation and keeps the remainder frozen", () => {
    const plan = buildClearingConfirmationPlan({
      kind: "final_confirmed",
      amountCents: 400n,
      authoritativeGrossCapCents: 1_000n,
      confirmedAgainstCapCents: 0n,
      category: "management_fee",
      allocations: [
        {
          sourceEventVersionId: "withheld-version-1",
          sourceKind: "withheld",
          amountCents: 400n,
          sourceRemainingCents: 1_000n
        }
      ]
    });

    expect(plan.allocations).toEqual([
      expect.objectContaining({
        sourceEventVersionId: "withheld-version-1",
        amountCents: 400n,
        sourceRemainingAfterCents: 600n
      })
    ]);
    expect(plan.impacts).toEqual([
      expect.objectContaining({
        impactKind: "construction_enterprise_funds_release",
        amountCents: 400n,
        direction: "increase"
      }),
      expect.objectContaining({
        impactKind: "confirmed_cost",
        amountCents: 400n,
        direction: "increase"
      }),
      expect.objectContaining({
        impactKind: "construction_enterprise_funds_decrease",
        amountCents: 400n,
        direction: "decrease"
      })
    ]);
  });

  it("rejects supplemental amounts beyond the authoritative gross cap", () => {
    expect(() =>
      buildClearingConfirmationPlan({
        kind: "supplemental",
        amountCents: 301n,
        authoritativeGrossCapCents: 1_000n,
        confirmedAgainstCapCents: 700n,
        category: "final_tax",
        allocations: [
          {
            sourceEventVersionId: null,
            sourceKind: "authority_cap",
            amountCents: 301n,
            sourceRemainingCents: 300n
          }
        ]
      })
    ).toThrow("超过权威毛额上限");
  });

  it("rejects returned amounts beyond the referenced remaining balance", () => {
    expect(() =>
      buildClearingConfirmationPlan({
        kind: "returned",
        amountCents: 501n,
        authoritativeGrossCapCents: 1_000n,
        confirmedAgainstCapCents: 500n,
        category: "deposit",
        allocations: [
          {
            sourceEventVersionId: "final-version-1",
            sourceKind: "final_confirmed",
            amountCents: 501n,
            sourceRemainingCents: 500n
          }
        ]
      })
    ).toThrow("超过来源剩余余额");
  });

  it("rejects cumulative allocations beyond one source remaining balance", () => {
    expect(() =>
      buildClearingConfirmationPlan({
        kind: "final_confirmed",
        amountCents: 120n,
        authoritativeGrossCapCents: 1_000n,
        confirmedAgainstCapCents: 0n,
        category: "management_fee",
        allocations: [
          {
            sourceEventVersionId: "withheld-version-1",
            sourceKind: "withheld",
            amountCents: 60n,
            sourceRemainingCents: 100n
          },
          {
            sourceEventVersionId: "withheld-version-1",
            sourceKind: "withheld",
            amountCents: 60n,
            sourceRemainingCents: 100n
          }
        ]
      })
    ).toThrow("超过来源剩余余额");
  });

  it("requires positive CNY integer cents and explicit allocations", () => {
    expect(() =>
      buildClearingConfirmationPlan({
        kind: "final_confirmed",
        amountCents: -1n,
        authoritativeGrossCapCents: 1_000n,
        confirmedAgainstCapCents: 0n,
        category: "management_fee",
        allocations: []
      })
    ).toThrow("金额必须是正整数分");
  });

  it("rejects any overlap between handler and confirmer actor sets", () => {
    expect(() =>
      assertClearingActorsDisjoint(
        ["finance-staff-1", "delegator-1"],
        ["finance-director-1", "delegator-1"]
      )
    ).toThrow(ConflictException);
  });

  it("fingerprints normalized payload and actor context deterministically", () => {
    const first = fingerprintClearingCommand({
      action: "clearing.event.confirm",
      aggregateId: "case-1",
      expectedRevision: 4,
      actorUserId: "director-1",
      delegatorUserId: null,
      payload: { allocations: [{ amountCents: "400", source: "withheld-1" }] }
    });
    const reordered = fingerprintClearingCommand({
      payload: { allocations: [{ source: "withheld-1", amountCents: "400" }] },
      delegatorUserId: null,
      actorUserId: "director-1",
      expectedRevision: 4,
      aggregateId: "case-1",
      action: "clearing.event.confirm"
    });
    const otherActor = fingerprintClearingCommand({
      action: "clearing.event.confirm",
      aggregateId: "case-1",
      expectedRevision: 4,
      actorUserId: "director-2",
      delegatorUserId: null,
      payload: { allocations: [{ amountCents: "400", source: "withheld-1" }] }
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(otherActor);
  });
});

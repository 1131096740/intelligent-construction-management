import { describe, expect, it } from "vitest";
import {
  contractDraftLeaseCanEdit,
  contractDraftLeaseExpired,
  contractDraftLeaseLost,
  contractDraftLeaseNeedsVerification,
  contractDraftLeaseViewFromGrant,
  contractDraftLeaseViewFromWorkbench
} from "./contract-draft-lease.state";

describe("contract draft lease state", () => {
  it("keeps the raw token outside the public serializable state", () => {
    const state = contractDraftLeaseViewFromGrant({
      leaseRevision: 3,
      expiresAt: "2026-07-28T00:02:00.000Z",
      heartbeatIntervalMs: 30_000
    });

    expect(state).toMatchObject({
      kind: "held",
      leaseRevision: 3,
      expiresAtMs: Date.parse("2026-07-28T00:02:00.000Z"),
      heartbeatIntervalMs: 30_000
    });
    expect(JSON.stringify(state)).not.toContain("token");
    expect(contractDraftLeaseCanEdit(state, Date.parse("2026-07-28T00:01:59.999Z")))
      .toBe(true);
  });

  it("does not let a second page silently reuse a same-user lease", () => {
    const state = contractDraftLeaseViewFromWorkbench({
      state: "held_by_me",
      holderDisplayName: "合同经办人",
      expiresAt: "2026-07-28T00:02:00.000Z",
      canTakeOver: false
    });

    expect(state).toMatchObject({
      kind: "held_elsewhere",
      holderDisplayName: "合同经办人",
      canTakeOver: false
    });
    expect(contractDraftLeaseCanEdit(state, Date.parse("2026-07-28T00:01:00.000Z")))
      .toBe(false);
  });

  it("requires a heartbeat at 30 seconds and becomes readonly at expiry", () => {
    const state = contractDraftLeaseViewFromGrant({
      leaseRevision: 1,
      expiresAt: "2026-07-28T00:02:00.000Z",
      heartbeatIntervalMs: 30_000
    }, Date.parse("2026-07-28T00:00:00.000Z"));

    expect(contractDraftLeaseNeedsVerification(
      state,
      Date.parse("2026-07-28T00:00:29.999Z")
    )).toBe(false);
    expect(contractDraftLeaseNeedsVerification(
      state,
      Date.parse("2026-07-28T00:00:30.000Z")
    )).toBe(true);
    expect(contractDraftLeaseExpired(
      state,
      Date.parse("2026-07-28T00:02:00.000Z")
    )).toBe(true);
    expect(contractDraftLeaseCanEdit(
      state,
      Date.parse("2026-07-28T00:02:00.000Z")
    )).toBe(false);
  });

  it("marks a taken-over or expired lease readonly without exposing secrets", () => {
    const lost = contractDraftLeaseLost("lease_taken_over");

    expect(lost).toEqual({
      kind: "lost",
      reason: "lease_taken_over"
    });
    expect(contractDraftLeaseCanEdit(lost, Date.now())).toBe(false);
  });
});

import type {
  ContractDraftLeaseGrant,
  ContractDraftLeaseState
} from "../../../api/contract-workbench.api";

export type ContractDraftLeaseView =
  | {
      kind: "available";
      canTakeOver: boolean;
    }
  | {
      kind: "held";
      leaseRevision: number;
      expiresAtMs: number;
      heartbeatIntervalMs: number;
      lastVerifiedAtMs: number;
    }
  | {
      kind: "held_elsewhere";
      holderDisplayName: string | null;
      expiresAtMs: number | null;
      canTakeOver: boolean;
    }
  | {
      kind: "lost";
      reason: "lease_expired" | "lease_taken_over" | "verification_failed";
    };

export function contractDraftLeaseViewFromGrant(
  grant: Omit<ContractDraftLeaseGrant, "token">,
  now = Date.now()
): ContractDraftLeaseView {
  return {
    kind: "held",
    leaseRevision: grant.leaseRevision,
    expiresAtMs: Date.parse(grant.expiresAt),
    heartbeatIntervalMs: grant.heartbeatIntervalMs,
    lastVerifiedAtMs: now
  };
}

export function contractDraftLeaseViewFromWorkbench(
  lease: ContractDraftLeaseState
): ContractDraftLeaseView {
  if (lease.state === "available" || lease.state === "expired") {
    return {
      kind: "available",
      canTakeOver: lease.canTakeOver
    };
  }
  return {
    kind: "held_elsewhere",
    holderDisplayName: lease.holderDisplayName,
    expiresAtMs: lease.expiresAt ? Date.parse(lease.expiresAt) : null,
    canTakeOver: lease.canTakeOver
  };
}

export function contractDraftLeaseLost(
  reason: Extract<ContractDraftLeaseView, { kind: "lost" }>["reason"]
): ContractDraftLeaseView {
  return { kind: "lost", reason };
}

export function contractDraftLeaseExpired(
  lease: ContractDraftLeaseView,
  now = Date.now()
): boolean {
  return lease.kind === "held" && (
    !Number.isFinite(lease.expiresAtMs) || lease.expiresAtMs <= now
  );
}

export function contractDraftLeaseCanEdit(
  lease: ContractDraftLeaseView,
  now = Date.now()
): boolean {
  return lease.kind === "held" && !contractDraftLeaseExpired(lease, now);
}

export function contractDraftLeaseNeedsVerification(
  lease: ContractDraftLeaseView,
  now = Date.now()
): boolean {
  return lease.kind === "held" &&
    now - lease.lastVerifiedAtMs >= lease.heartbeatIntervalMs;
}

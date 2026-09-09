import { describe, expect, it } from "vitest";

import {
  CLEARING_EVENT_KINDS,
  CLEARING_WORKFLOW_STATUSES,
  clearingActionRoles,
  isClearingEventKind,
  isClearingWorkflowStatus,
  reduceClearingReconciliationRisk
} from "./clearing";

describe("clearing shared contract", () => {
  it("keeps economic event kinds separate from workflow state", () => {
    expect(CLEARING_EVENT_KINDS).toEqual([
      "estimated",
      "withheld",
      "pending_reconciliation",
      "final_confirmed",
      "supplemental",
      "returned",
      "coverage_added",
      "continued_withheld",
      "technical_reversal"
    ]);
    expect(CLEARING_WORKFLOW_STATUSES).toEqual([
      "draft",
      "submitted",
      "confirmed",
      "returned",
      "cancelled"
    ]);
    expect(isClearingEventKind("submitted")).toBe(false);
    expect(isClearingWorkflowStatus("withheld")).toBe(false);
  });

  it("allows finance staff to prepare while reserving confirmation for finance directors", () => {
    expect(clearingActionRoles("prepare")).toEqual([
      "finance_staff",
      "finance_director"
    ]);
    expect(clearingActionRoles("confirm")).toEqual(["finance_director"]);
    expect(clearingActionRoles("return")).toEqual(["finance_director"]);
    expect(clearingActionRoles("reconciliation.reverse")).toEqual([
      "finance_director"
    ]);
    expect(clearingActionRoles("read")).toEqual([
      "finance_staff",
      "finance_director"
    ]);
  });

  it("fails closed for unknown event kinds and workflow states", () => {
    expect(isClearingEventKind("free_negative_adjustment")).toBe(false);
    expect(isClearingWorkflowStatus("auto_released")).toBe(false);
  });

  it("replays explicit reconciliation coverage and resolution as of the requested instant", () => {
    expect(CLEARING_EVENT_KINDS).toEqual(expect.arrayContaining([
      "coverage_added",
      "continued_withheld",
      "technical_reversal"
    ]));

    const base = {
      legacyPendingEvents: [],
      revisions: [{
        id: "revision-1",
        itemId: "item-1",
        decisionEventVersionId: "pending-v1",
        adoptsLegacyPendingEventVersionId: null,
        revisionNo: 1,
        kind: "open" as const,
        amountCents: 100n,
        replacesRevisionId: null,
        confirmedAt: "2026-09-01T00:00:00.000Z",
        effectiveCaseRevision: 1
      }],
      coverages: [{
        id: "coverage-1",
        reconciliationRevisionId: "revision-1",
        withheldEventVersionId: "withheld-v1",
        amountCents: 100n,
        confirmedAt: "2026-09-01T00:00:00.000Z",
        effectiveCaseRevision: 1
      }],
      resolutions: [
        {
          id: "resolution-final",
          reconciliationRevisionId: "revision-1",
          itemId: "item-1",
          entryKind: "resolution" as const,
          resultKind: "final_confirmed" as const,
          amountCents: 40n,
          reversesResolutionId: null,
          confirmedAt: "2026-09-02T00:00:00.000Z",
          effectiveCaseRevision: 2
        },
        {
          id: "resolution-retained",
          reconciliationRevisionId: "revision-1",
          itemId: "item-1",
          entryKind: "resolution" as const,
          resultKind: "continued_withheld" as const,
          amountCents: 20n,
          reversesResolutionId: null,
          confirmedAt: "2026-09-03T00:00:00.000Z",
          effectiveCaseRevision: 3
        },
        {
          id: "reversal-final",
          reconciliationRevisionId: "revision-1",
          itemId: "item-1",
          entryKind: "technical_reversal" as const,
          resultKind: "final_confirmed" as const,
          amountCents: 10n,
          reversesResolutionId: "resolution-final",
          confirmedAt: "2026-09-04T00:00:00.000Z",
          effectiveCaseRevision: 4
        },
        {
          id: "resolution-return",
          reconciliationRevisionId: "revision-1",
          itemId: "item-1",
          entryKind: "resolution" as const,
          resultKind: "real_return" as const,
          amountCents: 50n,
          reversesResolutionId: null,
          confirmedAt: "2026-09-05T00:00:00.000Z",
          effectiveCaseRevision: 5
        }
      ],
      resolutionLines: [
        ["line-final", "resolution-final", 40n, null],
        ["line-retained", "resolution-retained", 20n, null],
        ["line-reversal", "reversal-final", 10n, "line-final"],
        ["line-return", "resolution-return", 50n, null]
      ].map(([id, resolutionId, amountCents, reversesResolutionLineId]) => ({
        id: id as string,
        resolutionId: resolutionId as string,
        sourceKind: "withheld_coverage" as const,
        coverageId: "coverage-1",
        amountCents: amountCents as bigint,
        reversesResolutionLineId: reversesResolutionLineId as string | null
      })),
      definitionReversals: []
    };

    expect(reduceClearingReconciliationRisk({
      ...base,
      asOf: "2026-09-02T12:00:00.000Z"
    })).toMatchObject({
      relationshipCompleteness: "complete",
      openPendingGrossCents: 60n,
      openCoveredCents: 60n,
      openUncoveredCents: 0n,
      continuedWithheldRetainedCents: 0n
    });
    expect(reduceClearingReconciliationRisk({
      ...base,
      asOf: "2026-09-04T12:00:00.000Z"
    })).toMatchObject({
      relationshipCompleteness: "complete",
      openPendingGrossCents: 50n,
      openCoveredCents: 50n,
      openUncoveredCents: 0n,
      continuedWithheldRetainedCents: 20n
    });
    expect(reduceClearingReconciliationRisk({
      ...base,
      asOf: "2026-09-05T12:00:00.000Z"
    })).toMatchObject({
      relationshipCompleteness: "complete",
      openPendingGrossCents: 0n,
      openCoveredCents: 0n,
      openUncoveredCents: 0n,
      continuedWithheldRetainedCents: 20n
    });
  });

  it("keeps continued-withheld occupancy when a replacement becomes current", () => {
    const risk = reduceClearingReconciliationRisk({
      asOf: "2026-09-03T00:00:00.000Z",
      legacyPendingEvents: [],
      revisions: [
        {
          id: "revision-1",
          itemId: "item-1",
          decisionEventVersionId: "pending-v1",
          adoptsLegacyPendingEventVersionId: null,
          revisionNo: 1,
          kind: "open",
          amountCents: 100n,
          replacesRevisionId: null,
          confirmedAt: "2026-09-01T00:00:00.000Z",
          effectiveCaseRevision: 1
        },
        {
          id: "revision-2",
          itemId: "item-1",
          decisionEventVersionId: "pending-v2",
          adoptsLegacyPendingEventVersionId: null,
          revisionNo: 2,
          kind: "replace",
          amountCents: 80n,
          replacesRevisionId: "revision-1",
          confirmedAt: "2026-09-03T00:00:00.000Z",
          effectiveCaseRevision: 3
        }
      ],
      coverages: [
        {
          id: "coverage-1",
          reconciliationRevisionId: "revision-1",
          withheldEventVersionId: "withheld-v1",
          amountCents: 100n,
          confirmedAt: "2026-09-01T00:00:00.000Z",
          effectiveCaseRevision: 1
        },
        {
          id: "coverage-2",
          reconciliationRevisionId: "revision-2",
          withheldEventVersionId: "withheld-v1",
          amountCents: 80n,
          confirmedAt: "2026-09-03T00:00:00.000Z",
          effectiveCaseRevision: 3
        }
      ],
      resolutions: [{
        id: "retained-1",
        reconciliationRevisionId: "revision-1",
        itemId: "item-1",
        entryKind: "resolution",
        resultKind: "continued_withheld",
        amountCents: 20n,
        reversesResolutionId: null,
        confirmedAt: "2026-09-02T00:00:00.000Z",
        effectiveCaseRevision: 2
      }],
      resolutionLines: [{
        id: "retained-line-1",
        resolutionId: "retained-1",
        sourceKind: "withheld_coverage",
        coverageId: "coverage-1",
        amountCents: 20n,
        reversesResolutionLineId: null
      }],
      definitionReversals: []
    });

    expect(risk).toMatchObject({
      relationshipCompleteness: "complete",
      openPendingGrossCents: 80n,
      openCoveredCents: 80n,
      continuedWithheldRetainedCents: 20n,
      coveredWithheldSources: [{
        withheldEventVersionId: "withheld-v1",
        openCoveredCents: 80n,
        continuedRetainedCents: 20n
      }]
    });
  });

  it("replays a new replacement against the restored effective revision after definition reversal", () => {
    const risk = reduceClearingReconciliationRisk({
      asOf: "2026-09-05T00:00:00.000Z",
      legacyPendingEvents: [],
      revisions: [
        {
          id: "revision-1",
          itemId: "item-1",
          decisionEventVersionId: "pending-v1",
          adoptsLegacyPendingEventVersionId: null,
          revisionNo: 1,
          kind: "open",
          amountCents: 100n,
          replacesRevisionId: null,
          confirmedAt: "2026-09-01T00:00:00.000Z",
          effectiveCaseRevision: 1
        },
        {
          id: "revision-2",
          itemId: "item-1",
          decisionEventVersionId: "pending-v2",
          adoptsLegacyPendingEventVersionId: null,
          revisionNo: 2,
          kind: "replace",
          amountCents: 80n,
          replacesRevisionId: "revision-1",
          confirmedAt: "2026-09-02T00:00:00.000Z",
          effectiveCaseRevision: 2
        },
        {
          id: "revision-3",
          itemId: "item-1",
          decisionEventVersionId: "pending-v3",
          adoptsLegacyPendingEventVersionId: null,
          revisionNo: 3,
          kind: "replace",
          amountCents: 70n,
          replacesRevisionId: "revision-1",
          confirmedAt: "2026-09-04T00:00:00.000Z",
          effectiveCaseRevision: 4
        }
      ],
      coverages: [],
      resolutions: [],
      resolutionLines: [],
      definitionReversals: [{
        id: "definition-reversal-2",
        targetRevisionId: "revision-2",
        confirmedAt: "2026-09-03T00:00:00.000Z",
        effectiveCaseRevision: 3
      }]
    });

    expect(risk).toMatchObject({
      relationshipCompleteness: "coverage_incomplete",
      openPendingGrossCents: 70n,
      openCoveredCents: 0n,
      openUncoveredCents: 70n,
      items: [{
        itemId: "item-1",
        currentRevisionId: "revision-3",
        openAmountCents: 70n
      }]
    });
  });

  it("fails closed for an orphan resolution line instead of treating it as zero", () => {
    expect(reduceClearingReconciliationRisk({
      asOf: "2026-09-01T00:00:00.000Z",
      legacyPendingEvents: [],
      revisions: [],
      coverages: [],
      resolutions: [],
      resolutionLines: [{
        id: "orphan-line",
        resolutionId: "missing-resolution",
        sourceKind: "withheld_coverage",
        coverageId: "missing-coverage",
        amountCents: 1n,
        reversesResolutionLineId: null
      }],
      definitionReversals: []
    }).relationshipCompleteness).toBe("integrity_conflict");
  });
});

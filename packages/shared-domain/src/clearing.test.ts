import { describe, expect, it } from "vitest";

import {
  CLEARING_EVENT_KINDS,
  CLEARING_WORKFLOW_STATUSES,
  clearingActionRoles,
  isClearingEventKind,
  isClearingWorkflowStatus
} from "./clearing";

describe("clearing shared contract", () => {
  it("keeps economic event kinds separate from workflow state", () => {
    expect(CLEARING_EVENT_KINDS).toEqual([
      "estimated",
      "withheld",
      "pending_reconciliation",
      "final_confirmed",
      "supplemental",
      "returned"
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
    expect(clearingActionRoles("read")).toEqual([
      "finance_staff",
      "finance_director"
    ]);
  });

  it("fails closed for unknown event kinds and workflow states", () => {
    expect(isClearingEventKind("free_negative_adjustment")).toBe(false);
    expect(isClearingWorkflowStatus("auto_released")).toBe(false);
  });
});

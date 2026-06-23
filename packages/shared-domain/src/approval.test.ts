import { describe, expect, it } from "vitest";
import {
  APPROVAL_ACTIONS,
  APPROVAL_NODE_MODES,
  DEFAULT_APPROVAL_REMINDER_INTERVAL_HOURS,
  DEFAULT_APPROVAL_SLA_HOURS,
  approvalElapsedHours,
  canRemindApproval,
  isApprovalOverdue
} from "./approval";

describe("approval domain constants", () => {
  it("supports unanimous and either-or approval modes", () => {
    expect(APPROVAL_NODE_MODES).toEqual(["all", "any"]);
  });

  it("includes archive confirmation actions for contract department confirmation", () => {
    expect(APPROVAL_ACTIONS).toContain("archive_confirm");
    expect(APPROVAL_ACTIONS).toContain("archive_reject");
  });

  it("includes a remind action for overdue approval nudges", () => {
    expect(APPROVAL_ACTIONS).toContain("remind");
  });
});

describe("approval timeout / reminder logic", () => {
  const base = new Date("2026-06-23T00:00:00.000Z");
  const hoursLater = (hours: number) => new Date(base.getTime() + hours * 3_600_000);

  it("measures elapsed hours between two timestamps", () => {
    expect(approvalElapsedHours(base, hoursLater(36))).toBe(36);
  });

  it("flags an instance overdue once the SLA has elapsed", () => {
    expect(isApprovalOverdue(base, hoursLater(DEFAULT_APPROVAL_SLA_HOURS - 1))).toBe(false);
    expect(isApprovalOverdue(base, hoursLater(DEFAULT_APPROVAL_SLA_HOURS))).toBe(true);
  });

  it("honours a custom SLA", () => {
    expect(isApprovalOverdue(base, hoursLater(5), 4)).toBe(true);
    expect(isApprovalOverdue(base, hoursLater(3), 4)).toBe(false);
  });

  it("allows a reminder only for an overdue in-progress instance", () => {
    expect(
      canRemindApproval({
        status: "in_progress",
        lastActivityAt: base,
        now: hoursLater(DEFAULT_APPROVAL_SLA_HOURS)
      })
    ).toBe(true);

    expect(
      canRemindApproval({
        status: "in_progress",
        lastActivityAt: base,
        now: hoursLater(DEFAULT_APPROVAL_SLA_HOURS - 1)
      })
    ).toBe(false);

    expect(
      canRemindApproval({
        status: "approved",
        lastActivityAt: base,
        now: hoursLater(DEFAULT_APPROVAL_SLA_HOURS + 100)
      })
    ).toBe(false);
  });

  it("throttles repeat reminders within the reminder interval", () => {
    const now = hoursLater(DEFAULT_APPROVAL_SLA_HOURS + DEFAULT_APPROVAL_REMINDER_INTERVAL_HOURS);

    expect(
      canRemindApproval({
        status: "in_progress",
        lastActivityAt: base,
        lastRemindedAt: new Date(now.getTime() - 1_000),
        now
      })
    ).toBe(false);

    expect(
      canRemindApproval({
        status: "in_progress",
        lastActivityAt: base,
        lastRemindedAt: new Date(
          now.getTime() - DEFAULT_APPROVAL_REMINDER_INTERVAL_HOURS * 3_600_000
        ),
        now
      })
    ).toBe(true);
  });
});

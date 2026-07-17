import { SETTLEMENT_LINE_OCCUPANCY_STATUSES } from "./settlement-line-occupancy";

describe("settlement line occupancy statuses", () => {
  it("uses the shared legacy-compatible occupancy set", () => {
    expect(SETTLEMENT_LINE_OCCUPANCY_STATUSES).toEqual([
      "in_approval",
      "approval_pending",
      "approved_pending_archive",
      "archive_pending",
      "pending_archive_confirm",
      "effective",
      "partially_paid",
      "paid"
    ]);
  });
});

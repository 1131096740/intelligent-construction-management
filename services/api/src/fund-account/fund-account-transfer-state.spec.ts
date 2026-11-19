import { transferStateAfterAction, transferUsesHeldFunds } from "./fund-account-transfer-state";

it("holds the outgoing amount across rejection and resubmission until actual receipt or return", () => {
  expect(transferUsesHeldFunds("pending_receipt")).toBe(true);
  const rejected = transferStateAfterAction("pending_receipt", "reject");
  expect(rejected).toBe("rejected_held");
  expect(transferUsesHeldFunds(rejected)).toBe(true);
  expect(() => transferStateAfterAction(rejected, "confirm")).toThrow("当前状态不能办理");
  const resubmitted = transferStateAfterAction(rejected, "resubmit");
  expect(resubmitted).toBe("pending_receipt");
  expect(transferUsesHeldFunds(resubmitted)).toBe(true);
  const confirmed = transferStateAfterAction(resubmitted, "confirm");
  expect(confirmed).toBe("received");
  expect(transferUsesHeldFunds(confirmed)).toBe(false);
  expect(() => transferStateAfterAction(confirmed, "confirm")).toThrow("当前状态不能办理");

  expect(() => transferStateAfterAction("pending_receipt", "return")).toThrow("当前状态不能办理");
  const returned = transferStateAfterAction(rejected, "return");
  expect(returned).toBe("returned");
  expect(transferUsesHeldFunds(returned)).toBe(false);
});

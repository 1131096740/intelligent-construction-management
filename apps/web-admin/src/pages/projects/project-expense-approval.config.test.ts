import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  canBeginProjectExpenseReview,
  projectExpenseApprovedAmountCents,
  submitConfirmedProjectExpenseReview
} from "./project-expense-approval.config";

const detailPageSource = readFileSync(
  fileURLToPath(new URL("./ProjectExpenseApprovalDetailPage.vue", import.meta.url)),
  "utf8"
);

describe("project expense approval interaction", () => {
  it("does not submit when the user cancels the sensitive confirmation", async () => {
    const confirm = vi.fn().mockReturnValue(false);
    const submit = vi.fn();

    await expect(
      submitConfirmedProjectExpenseReview({ decision: "approve", confirm, submit })
    ).resolves.toBe(false);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits exactly once after confirmation", async () => {
    const confirm = vi.fn().mockReturnValue(true);
    const submit = vi.fn().mockResolvedValue(undefined);

    await expect(
      submitConfirmedProjectExpenseReview({ decision: "reject", confirm, submit })
    ).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("blocks programmatic concurrent review while another review is busy", () => {
    expect(canBeginProjectExpenseReview("")).toBe(true);
    expect(canBeginProjectExpenseReview("approve")).toBe(false);
    expect(canBeginProjectExpenseReview("reject")).toBe(false);
  });

  it("only sends a positive approved amount from the final node", () => {
    expect(projectExpenseApprovedAmountCents(false, "approve", "12.34")).toBeUndefined();
    expect(projectExpenseApprovedAmountCents(true, "reject", "12.34")).toBeUndefined();
    expect(projectExpenseApprovedAmountCents(true, "approve", "")).toBeUndefined();
    expect(projectExpenseApprovedAmountCents(true, "approve", "12.34")).toBe("1234");
  });

  it.each(["0", "0.00", "-1", "abc", "1.234"])(
    "rejects an invalid final approved amount: %s",
    (value) => {
      expect(() => projectExpenseApprovedAmountCents(true, "approve", value)).toThrow(
        "批准金额必须是大于 0 的数字，最多保留两位小数"
      );
    }
  );

  it("renders only server-projected withdrawal and void actions through the shared sensitive action", () => {
    expect(detailPageSource).toContain("<BusinessDraftAction");
    expect(detailPageSource).toContain(':actions="detail.availableActions"');
    expect(detailPageSource).toContain(':blocked-reasons="detail.blockedReasons"');
    expect(detailPageSource).toContain("withdrawProjectExpenseApproval");
    expect(detailPageSource).toContain("voidProjectExpenseRequest");
    expect(detailPageSource).not.toContain("canWithdrawProjectExpense");
    expect(detailPageSource).not.toContain("canVoidProjectExpense");
  });
});

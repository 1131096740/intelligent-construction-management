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

  it("isolates the server-authorized withdrawal from the independent void action", () => {
    expect(detailPageSource.match(/<BusinessDraftAction\b/g)).toHaveLength(1);
    expect(detailPageSource).toContain("<SensitiveActionDialog");
    expect(detailPageSource).toContain(
      '@confirm="confirmProjectExpenseWithdrawal"'
    );
    expect(detailPageSource).toContain(
      "projectExpenseWithdrawalActionEnabled('withdraw')"
    );
    expect(detailPageSource).toContain(
      "撤回后本轮审批结束，申请进入已撤回历史记录"
    );
    expect(detailPageSource).not.toContain("撤回后申请回到可修改状态");
    expect(detailPageSource).toContain(
      ':actions="nonWithdrawalLifecycleActions"'
    );
    expect(detailPageSource).toContain(':blocked-reasons="detail.blockedReasons"');
    expect(detailPageSource).toContain("shallowRef");
    expect(detailPageSource).toContain("structuredClone(serverDetail)");
    expect(detailPageSource).toContain("prepareProjectExpenseWithdrawalAction");
    expect(detailPageSource).toContain("executeProjectExpenseWithdrawalAction");
    expect(detailPageSource).toContain('action: "withdraw"');
    expect(detailPageSource).toContain("voidProjectExpenseRequest");
    expect(detailPageSource).not.toContain("withdrawProjectExpenseApproval");
    expect(detailPageSource).not.toContain("canWithdrawProjectExpense");
    expect(detailPageSource).not.toContain("canVoidProjectExpense");
  });

  it("binds project expense execution to the raw detail capability and governed upload helper", () => {
    expect(detailPageSource).toContain("record_execution");
    expect(detailPageSource).toContain("executionContext");
    expect(detailPageSource).toContain("recordProjectExpenseExecutionWithUpload");
    expect(detailPageSource).toContain("createProjectExpenseExecutionRecordAttemptState");
    expect(detailPageSource).toContain('@confirm="confirmProjectExpenseExecution"');
    expect(detailPageSource).toContain("<t-upload");
    expect(detailPageSource).toContain("CORE_ARCHIVE_UPLOAD_POLICY");
    expect(detailPageSource).not.toContain("recordProjectExpenseExecution(");
    expect(detailPageSource).not.toContain("fetch(");
  });
});

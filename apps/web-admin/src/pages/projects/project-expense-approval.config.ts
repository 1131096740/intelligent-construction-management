import { yuanTextToCentsText } from "../../lib/money";

type ProjectExpenseReviewDecision = "approve" | "reject";

export function canBeginProjectExpenseReview(busy: string) {
  return busy === "";
}

export function projectExpenseApprovedAmountCents(
  canSetApprovedAmount: boolean,
  decision: ProjectExpenseReviewDecision,
  rawValue: string
): string | undefined {
  if (!canSetApprovedAmount || decision !== "approve") return undefined;
  const value = rawValue.trim();
  if (!value) return undefined;

  let amountCents: string;
  try {
    amountCents = yuanTextToCentsText(value);
  } catch {
    throw new Error("批准金额必须是大于 0 的数字，最多保留两位小数");
  }
  if (amountCents === "0") {
    throw new Error("批准金额必须是大于 0 的数字，最多保留两位小数");
  }
  return amountCents;
}

export async function submitConfirmedProjectExpenseReview(input: {
  decision: ProjectExpenseReviewDecision;
  confirm(message: string): boolean;
  submit(): Promise<void>;
}) {
  const message = input.decision === "approve"
    ? "确认审批通过该项目支出？提交后将推进审批流程，终审通过后进入待付款。"
    : "确认驳回该项目支出？提交后本次审批流程将结束。";
  if (!input.confirm(message)) return false;

  await input.submit();
  return true;
}

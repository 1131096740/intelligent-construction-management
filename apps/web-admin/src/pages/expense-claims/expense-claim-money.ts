import { normalizeBusinessAmount, normalizeExpenseQuantity } from "@jiangkong/shared-domain";
import { centsTextToYuanText } from "../../lib/money";

export function parseExpenseAmountYuan(input: string, label: string): string {
  let amount: string | null;
  try {
    amount = normalizeBusinessAmount(input.trim());
  } catch (error) {
    throw new Error(`${label}：${(error as Error).message}`);
  }
  if (amount === null || amount === "0.0000") throw new Error(`${label}必须大于 0`);
  return amount;
}

export function validateExpenseQuantity(input: string, label: string): void {
  try {
    normalizeExpenseQuantity(input);
  } catch (error) {
    throw new Error(`${label}：${(error as Error).message}`);
  }
}

export function displayExpenseAmount(amountYuan: string | null | undefined, amountCents: string) {
  return `¥${amountYuan ?? centsTextToYuanText(amountCents)}`;
}

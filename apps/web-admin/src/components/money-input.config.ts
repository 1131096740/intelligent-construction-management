import { centsTextToYuanText, yuanTextToCentsText } from "../lib/money";

export function moneyInputError(value: string, required: boolean) {
  const normalized = value.trim();
  if (!normalized) {
    return required ? "请输入金额" : "";
  }

  try {
    yuanTextToCentsText(normalized);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "金额格式不正确";
  }
}

export function normalizedMoneyYuanText(value: string) {
  return centsTextToYuanText(yuanTextToCentsText(value.trim()));
}

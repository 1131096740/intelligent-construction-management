import { BadRequestException } from "@nestjs/common";

/**
 * #404 EXP-02 明细数量：可空；有值时按 D02 新精度协议最多 4 位小数。
 * 空值表示“未填数量”，与 0 不同，也不参与金额反推。
 */
const DECIMAL_QUANTITY = /^\d+(?:\.\d{1,4})?$/u;
const MAX_QUANTITY_INTEGER_DIGITS = 20;

export function parseExpenseQuantity(input: string | undefined | null): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  if (!DECIMAL_QUANTITY.test(text)) {
    if (/^\d+\.\d{5,}$/u.test(text)) throw new BadRequestException("数量最多 4 位小数");
    throw new BadRequestException("数量格式不正确，请填写正数，最多 4 位小数");
  }
  const [integerPart, decimalPart] = text.split(".");
  if (integerPart.length > MAX_QUANTITY_INTEGER_DIGITS) {
    throw new BadRequestException("数量超出可登记范围");
  }
  const normalizedDecimal = (decimalPart ?? "").replace(/0+$/u, "");
  const normalized = normalizedDecimal ? `${integerPart}.${normalizedDecimal}` : integerPart;
  if (/^0(?:\.0*)?$/u.test(normalized)) {
    throw new BadRequestException("数量必须大于 0");
  }
  return normalized;
}

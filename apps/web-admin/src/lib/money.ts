const YUAN_INPUT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const CENTS_TEXT_PATTERN = /^-?\d+$/;

function normalizeUnsignedDigits(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

export function yuanTextToCentsText(value: string): string {
  if (typeof value !== "string" || !YUAN_INPUT_PATTERN.test(value)) {
    throw new Error("金额必须是非负数字，最多保留两位小数");
  }

  const [yuan, fraction = ""] = value.split(".");
  return normalizeUnsignedDigits(`${yuan}${fraction.padEnd(2, "0")}`);
}

export function centsTextToYuanText(value: string): string {
  if (typeof value !== "string" || !CENTS_TEXT_PATTERN.test(value)) {
    throw new Error("金额分值必须是十进制整数字符串");
  }

  const negative = value.startsWith("-");
  const digits = normalizeUnsignedDigits(negative ? value.slice(1) : value);
  const padded = digits.padStart(3, "0");
  const yuan = normalizeUnsignedDigits(padded.slice(0, -2));
  const fraction = padded.slice(-2);
  const groupedYuan = yuan.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative && digits !== "0" ? "-" : "";

  return `${sign}${groupedYuan}.${fraction}`;
}

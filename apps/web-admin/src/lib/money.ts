const YUAN_INPUT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const CENTS_TEXT_PATTERN = /^-?\d+$/;
const SPOT_PROCUREMENT_DECIMAL_TEXT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const SPOT_PROCUREMENT_MAX_INTEGER_DIGITS = 18;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

interface ParsedSpotProcurementDecimal {
  unscaled: bigint;
  scale: number;
}

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

function parseSpotProcurementDecimalText(
  value: string,
  field: "quantity" | "unitPrice"
): ParsedSpotProcurementDecimal {
  const match = SPOT_PROCUREMENT_DECIMAL_TEXT_PATTERN.exec(value);
  const invalidMessage =
    field === "quantity"
      ? "采购数量必须是大于 0、最多 6 位小数且可保存的普通十进制字符串"
      : "采购单价必须是大于等于 0、最多 6 位小数且可保存的普通十进制字符串";

  if (!match || match[1].length > SPOT_PROCUREMENT_MAX_INTEGER_DIGITS) {
    throw new Error(invalidMessage);
  }

  const fraction = match[2] ?? "";
  const unscaled = BigInt(`${match[1]}${fraction}`);
  if (field === "quantity" && unscaled === 0n) {
    throw new Error(invalidMessage);
  }

  return { unscaled, scale: fraction.length };
}

export function calculateSpotProcurementLineAmountCents(
  quantity: string,
  unitPrice: string
): string {
  const parsedQuantity = parseSpotProcurementDecimalText(quantity, "quantity");
  const parsedUnitPrice = parseSpotProcurementDecimalText(unitPrice, "unitPrice");
  const divisor =
    10n ** BigInt(parsedQuantity.scale + parsedUnitPrice.scale);
  const scaledAmount =
    parsedQuantity.unscaled * parsedUnitPrice.unscaled * 100n;
  const remainder = scaledAmount % divisor;
  let amountCents = scaledAmount / divisor;

  if (remainder * 2n >= divisor) {
    amountCents += 1n;
  }
  if (amountCents > POSTGRES_BIGINT_MAX) {
    throw new Error("采购明细金额超出系统可保存范围");
  }

  return amountCents.toString();
}

import { yuanTextToCentsText } from "../../lib/money";

const SPOT_PROCUREMENT_DECIMAL_TEXT = /^(0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MAX_SPOT_PROCUREMENT_INTEGER_DIGITS = 18;

export interface SpotPaymentLineDecimalInput {
  paymentQuantity: string;
  unitPrice: string;
}

type NamedUpload = { name: string };

export function requiredSpotProcurementDecimal(
  value: string,
  label: string,
  positive: boolean
) {
  const normalized = value.trim();
  const integerDigits = normalized.split(".", 1)[0]?.length ?? 0;
  const validValue =
    SPOT_PROCUREMENT_DECIMAL_TEXT.test(normalized) &&
    integerDigits <= MAX_SPOT_PROCUREMENT_INTEGER_DIGITS;
  const unscaled = validValue ? BigInt(normalized.replace(".", "")) : 0n;
  if (!validValue || (positive && unscaled === 0n)) {
    throw new Error(
      `${label}必须是${positive ? "大于 0" : "大于等于 0"}、最多 2 位小数且可保存的普通十进制字符串`
    );
  }
  return normalized;
}

export function validateSpotPaymentLines<
  T extends SpotPaymentLineDecimalInput
>(lines: readonly T[]): Array<T & SpotPaymentLineDecimalInput> {
  return lines.map((line) => ({
    ...line,
    paymentQuantity: requiredSpotProcurementDecimal(
      line.paymentQuantity,
      "付款数量",
      true
    ),
    unitPrice: requiredSpotProcurementDecimal(
      line.unitPrice,
      "含税或无票单价",
      false
    )
  }));
}

export function requiredPositiveYuanCents(value: string, label: string) {
  let amountCents: string;
  try {
    amountCents = yuanTextToCentsText(value);
  } catch {
    throw new Error(`${label}必须是大于 0、最多 2 位小数的金额`);
  }
  if (BigInt(amountCents) <= 0n) {
    throw new Error(`${label}必须是大于 0、最多 2 位小数的金额`);
  }
  return amountCents;
}

export async function validateThenUpload<
  ValidatedValue,
  FileValue extends NamedUpload,
  UploadValue
>(
  validate: () => ValidatedValue,
  files: readonly FileValue[],
  upload: (file: FileValue, fileName: string) => Promise<UploadValue>
) {
  const validatedValue = validate();
  const uploads = await Promise.all(
    files.map((file) => upload(file, file.name))
  );
  return { validatedValue, uploads };
}

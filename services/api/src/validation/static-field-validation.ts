import { registerDecorator } from "class-validator";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";

type StaticFieldRule = {
  name: string;
  message: string;
  validate: (value: unknown) => boolean;
};

export type RequiredTextMessages = {
  requiredMessage: string;
  typeMessage: string;
  blankMessage: string;
};

export type OptionalNonBlankTextMessages = {
  typeMessage: string;
  blankMessage: string;
};

export type CanonicalMoneyTextMessages = {
  typeMessage: string;
  formatMessage: string;
  rangeMessage?: string;
};

export type IntegerInRangeOptions = {
  min: number;
  max: number;
  typeMessage: string;
  rangeMessage: string;
};

export type OptionalNonEmptyArrayMessages = {
  typeMessage: string;
  emptyMessage: string;
};

export type MaxUnicodeTextLengthOptions = {
  max: number;
  message: string;
};

export type StrictDateOnlyOptions = {
  message: string;
};

function registerStaticFieldRule(
  target: object,
  propertyKey: string | symbol,
  rule: StaticFieldRule
) {
  registerDecorator({
    name: rule.name,
    target: target.constructor,
    propertyName: String(propertyKey),
    options: { message: rule.message },
    validator: { validate: rule.validate }
  });
}

function isRequiredTextPresent(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function isRequiredTextType(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

function isRequiredTextNotBlank(value: unknown) {
  return typeof value !== "string" || value.length === 0 || value.trim().length > 0;
}

function isOptionalTextType(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalTextNotBlank(value: unknown) {
  return value === undefined || typeof value !== "string" || value.trim().length > 0;
}

function isMoneyTextType(value: unknown) {
  return typeof value === "string";
}

function isCanonicalMoneyTextFormat(value: unknown) {
  return typeof value !== "string" || /^(0|[1-9]\d*)$/u.test(value);
}

function isCanonicalMoneyTextInStorageRange(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value)) return true;
  return isWithinPostgresBigIntRange(BigInt(value));
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isStrictDateOnlyFormat(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function IsRequiredText(messages: RequiredTextMessages): PropertyDecorator {
  return (target, propertyKey) => {
    registerStaticFieldRule(target, propertyKey, {
      name: "staticRequiredTextRequired",
      message: messages.requiredMessage,
      validate: isRequiredTextPresent
    });
    registerStaticFieldRule(target, propertyKey, {
      name: "staticRequiredTextType",
      message: messages.typeMessage,
      validate: isRequiredTextType
    });
    registerStaticFieldRule(target, propertyKey, {
      name: "staticRequiredTextBlank",
      message: messages.blankMessage,
      validate: isRequiredTextNotBlank
    });
  };
}

export function IsOptionalNonBlankText(
  messages: OptionalNonBlankTextMessages
): PropertyDecorator {
  return (target, propertyKey) => {
    registerStaticFieldRule(target, propertyKey, {
      name: "staticOptionalNonBlankTextType",
      message: messages.typeMessage,
      validate: isOptionalTextType
    });
    registerStaticFieldRule(target, propertyKey, {
      name: "staticOptionalNonBlankTextBlank",
      message: messages.blankMessage,
      validate: isOptionalTextNotBlank
    });
  };
}

export function IsCanonicalMoneyText(
  messages: CanonicalMoneyTextMessages
): PropertyDecorator {
  return (target, propertyKey) => {
    registerStaticFieldRule(target, propertyKey, {
      name: "staticCanonicalMoneyTextType",
      message: messages.typeMessage,
      validate: isMoneyTextType
    });
    registerStaticFieldRule(target, propertyKey, {
      name: "staticCanonicalMoneyTextFormat",
      message: messages.formatMessage,
      validate: isCanonicalMoneyTextFormat
    });
    registerStaticFieldRule(target, propertyKey, {
      name: "staticCanonicalMoneyTextRange",
      message: messages.rangeMessage ?? "金额超出系统可保存范围",
      validate: isCanonicalMoneyTextInStorageRange
    });
  };
}

export function IsIntegerInRange(options: IntegerInRangeOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerStaticFieldRule(target, propertyKey, {
      name: "staticIntegerInRangeType",
      message: options.typeMessage,
      validate: isSafeInteger
    });
    registerStaticFieldRule(target, propertyKey, {
      name: "staticIntegerInRangeValue",
      message: options.rangeMessage,
      validate: (value) =>
        !isSafeInteger(value) || (value >= options.min && value <= options.max)
    });
  };
}

export function IsOptionalNonEmptyArray(
  messages: OptionalNonEmptyArrayMessages
): PropertyDecorator {
  return (target, propertyKey) => {
    registerStaticFieldRule(target, propertyKey, {
      name: "staticOptionalNonEmptyArrayType",
      message: messages.typeMessage,
      validate: (value) => value === undefined || Array.isArray(value)
    });
    registerStaticFieldRule(target, propertyKey, {
      name: "staticOptionalNonEmptyArrayEmpty",
      message: messages.emptyMessage,
      validate: (value) => value === undefined || !Array.isArray(value) || value.length > 0
    });
  };
}

export function IsMaxUnicodeTextLength(
  options: MaxUnicodeTextLengthOptions
): PropertyDecorator {
  const max = options.max;
  const message = options.message;
  return (target, propertyKey) => {
    registerStaticFieldRule(target, propertyKey, {
      name: "staticMaxUnicodeTextLength",
      message,
      validate: (value) =>
        typeof value !== "string" ||
        value.trim().length === 0 ||
        Array.from(value).length <= max
    });
  };
}

export function IsStrictDateOnly(options: StrictDateOnlyOptions): PropertyDecorator {
  const message = options.message;
  return (target, propertyKey) => {
    registerStaticFieldRule(target, propertyKey, {
      name: "staticStrictDateOnly",
      message,
      validate: isStrictDateOnlyFormat
    });
  };
}

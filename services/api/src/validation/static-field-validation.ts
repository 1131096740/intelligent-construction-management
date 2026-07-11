import { registerDecorator } from "class-validator";

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
};

export type MaxUnicodeTextLengthOptions = {
  max: number;
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

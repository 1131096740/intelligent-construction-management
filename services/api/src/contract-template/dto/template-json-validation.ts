import { BadRequestException } from "@nestjs/common";
import { registerDecorator } from "class-validator";
import { API_RAW_BODY_PREFLIGHT } from "../../validation/api-validation";

export const INVALID_TEMPLATE_JSON_MESSAGE = "提交内容包含不可保存的 JSON 数据";

type JsonRuleOptions = {
  message: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function isJsonSafeValue(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        Object.getOwnPropertySymbols(value).length > 0
      ) {
        return false;
      }
      const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
        string,
        PropertyDescriptor
      >;
      const lengthDescriptor = descriptors.length;
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isInteger(lengthDescriptor.value)
      ) {
        return false;
      }
      const length = lengthDescriptor.value as number;
      const indexEntries = Object.entries(descriptors).filter(([key]) => key !== "length");
      if (indexEntries.length !== length) return false;

      return indexEntries.every(([key, descriptor]) => {
        if (!/^(0|[1-9]\d*)$/u.test(key)) return false;
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= length ||
          index > 4_294_967_294 ||
          String(index) !== key ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          return false;
        }
        return isJsonSafeValue(descriptor.value, ancestors);
      });
    }
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const valid = Object.values(descriptors).every(
      (descriptor) =>
        "value" in descriptor &&
        descriptor.enumerable === true &&
        isJsonSafeValue(descriptor.value, ancestors)
    );
    return valid;
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
}

export function IsJsonSafeValue(options: JsonRuleOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "staticTemplateJsonSafeValue",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: options.message },
      validator: { validate: (value) => isJsonSafeValue(value) }
    });
  };
}

export function IsJsonPlainRecord(options: JsonRuleOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "staticTemplateJsonPlainRecord",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: options.message },
      validator: {
        validate: (value) => isPlainRecord(value) && isJsonSafeValue(value)
      }
    });
  };
}

export abstract class JsonSafeTemplateBodyDto {
  static [API_RAW_BODY_PREFLIGHT](body: unknown) {
    if (!isPlainRecord(body) || !isJsonSafeValue(body)) {
      throw new BadRequestException({
        message: "提交内容格式不正确，请检查后重试",
        errors: [INVALID_TEMPLATE_JSON_MESSAGE]
      });
    }
  }
}

import {
  ArgumentMetadata,
  BadRequestException,
  ValidationError,
  ValidationPipe
} from "@nestjs/common";
import { getMetadataStorage } from "class-validator";

const INVALID_REQUEST_MESSAGE = "提交内容格式不正确，请检查后重试";
const BODY_MUST_BE_OBJECT_MESSAGE = "提交内容必须是对象";
const FALLBACK_ERROR_MESSAGE = "提交内容填写不正确";
const CHINESE_CHARACTER = /[\u3400-\u9fff]/u;
const SAFE_PROPERTY_PATH = /^[A-Za-z0-9_.[\]-]+$/u;
const DYNAMIC_MESSAGE_TOKEN = /\$(?:value|target|constraint\d+)/u;

export const API_RAW_BODY_PREFLIGHT = Symbol("apiRawBodyPreflight");

type RawBodyPreflightMetatype = {
  [API_RAW_BODY_PREFLIGHT]?: (value: unknown) => void;
};

function safePropertyPath(path: string): string | null {
  if (!path || path.length > 120 || !SAFE_PROPERTY_PATH.test(path)) {
    return null;
  }
  return path;
}

function joinPropertyPath(parent: string, property: string): string {
  if (!parent) {
    return property;
  }
  return /^\d+$/u.test(property) ? `${parent}[${property}]` : `${parent}.${property}`;
}

function getTargetConstructor(error: ValidationError) {
  try {
    if (!error.target || typeof error.target !== "object") {
      return null;
    }
    const constructor = error.target.constructor;
    return typeof constructor === "function" ? constructor : null;
  } catch {
    return null;
  }
}

function hasUnsafeMessageDefinition(error: ValidationError): boolean {
  const targetConstructor = getTargetConstructor(error);
  if (!targetConstructor || !error.property) {
    return true;
  }

  try {
    const propertyMetadata = getMetadataStorage()
      .getTargetValidationMetadatas(targetConstructor, "", false, false)
      .filter((metadata) => metadata.propertyName === error.property);
    if (propertyMetadata.length === 0) {
      return true;
    }
    return propertyMetadata.some(
      (metadata) =>
        typeof metadata.message === "function" ||
        (typeof metadata.message === "string" && DYNAMIC_MESSAGE_TOKEN.test(metadata.message))
    );
  } catch {
    return true;
  }
}

function getSensitiveValueRepresentations(value: unknown): string[] | null {
  const representations = new Set<string>();
  try {
    const stringValue = String(value);
    if (stringValue) {
      representations.add(stringValue);
    }
  } catch {
    return null;
  }

  if (typeof value === "object" && value !== null) {
    try {
      const jsonValue = JSON.stringify(value);
      if (jsonValue) {
        representations.add(jsonValue);
      }
    } catch {
      return null;
    }
  }
  return Array.from(representations);
}

function containsSensitiveValidationContext(message: string, error: ValidationError): boolean {
  const targetConstructor = getTargetConstructor(error);
  if (!targetConstructor) {
    return true;
  }
  if (targetConstructor.name && message.includes(targetConstructor.name)) {
    return true;
  }

  const valueRepresentations = getSensitiveValueRepresentations(error.value);
  if (!valueRepresentations) {
    return true;
  }
  return valueRepresentations.some((representation) => message.includes(representation));
}

function safeConstraintMessage(
  error: ValidationError,
  message: string,
  propertyPath: string
): string {
  if (
    hasUnsafeMessageDefinition(error) ||
    containsSensitiveValidationContext(message, error) ||
    !CHINESE_CHARACTER.test(message)
  ) {
    const safePath = safePropertyPath(propertyPath);
    return safePath ? `${safePath} 填写不正确` : FALLBACK_ERROR_MESSAGE;
  }
  return message;
}

function flattenValidationErrors(
  validationErrors: ValidationError[],
  parentPath = ""
): string[] {
  const messages: string[] = [];

  for (const error of validationErrors) {
    const propertyPath = joinPropertyPath(parentPath, error.property ?? "");
    const constraints = Object.entries(error.constraints ?? {});
    const hasNonNestedConstraint = constraints.some(
      ([constraint]) => constraint !== "nestedValidation"
    );
    for (const [constraint, message] of constraints) {
      if (constraint === "nestedValidation" && hasNonNestedConstraint) {
        continue;
      }
      if (constraint === "unknownValue") {
        messages.push(BODY_MUST_BE_OBJECT_MESSAGE);
        continue;
      }
      if (constraint === "whitelistValidation") {
        const safePath = safePropertyPath(propertyPath);
        messages.push(safePath ? `${safePath} 不是允许提交的字段` : "提交内容包含不允许的字段");
        continue;
      }
      messages.push(safeConstraintMessage(error, message, propertyPath));
    }
    if (constraints.length === 0) {
      messages.push(...flattenValidationErrors(error.children ?? [], propertyPath));
    }
  }

  return messages;
}

function createBadRequest(validationErrors: ValidationError[]): BadRequestException {
  const errors = Array.from(new Set(flattenValidationErrors(validationErrors)));
  return new BadRequestException({
    message: INVALID_REQUEST_MESSAGE,
    errors: errors.length > 0 ? errors : [FALLBACK_ERROR_MESSAGE]
  });
}

class ApiValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (
      metadata.type === "body" &&
      (value === null || typeof value !== "object" || Array.isArray(value))
    ) {
      throw new BadRequestException({
        message: INVALID_REQUEST_MESSAGE,
        errors: [BODY_MUST_BE_OBJECT_MESSAGE]
      });
    }
    if (metadata.type === "body" && metadata.metatype) {
      try {
        const preflight = (metadata.metatype as RawBodyPreflightMetatype)[
          API_RAW_BODY_PREFLIGHT
        ];
        preflight?.(value);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException({
          message: INVALID_REQUEST_MESSAGE,
          errors: [FALLBACK_ERROR_MESSAGE]
        });
      }
    }
    return super.transform(value, metadata);
  }
}

export function createApiValidationPipe(): ValidationPipe {
  return new ApiValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    stopAtFirstError: false,
    transformOptions: {
      enableImplicitConversion: false
    },
    validationError: {
      // class-validator expands $value/$target before exceptionFactory. Keep this
      // context only long enough to detect and discard dynamic or leaked messages;
      // createBadRequest never serializes either field into the public response.
      target: true,
      value: true
    },
    exceptionFactory: createBadRequest
  });
}

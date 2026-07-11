import {
  ArgumentMetadata,
  BadRequestException,
  ValidationError,
  ValidationPipe
} from "@nestjs/common";

const INVALID_REQUEST_MESSAGE = "提交内容格式不正确，请检查后重试";
const BODY_MUST_BE_OBJECT_MESSAGE = "提交内容必须是对象";
const FALLBACK_ERROR_MESSAGE = "提交内容填写不正确";
const CHINESE_CHARACTER = /[\u3400-\u9fff]/u;
const SAFE_PROPERTY_PATH = /^[A-Za-z0-9_.[\]-]+$/u;

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

function flattenValidationErrors(
  validationErrors: ValidationError[],
  parentPath = ""
): string[] {
  const messages: string[] = [];

  for (const error of validationErrors) {
    const propertyPath = joinPropertyPath(parentPath, error.property ?? "");
    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      if (constraint === "unknownValue") {
        messages.push(BODY_MUST_BE_OBJECT_MESSAGE);
        continue;
      }
      if (constraint === "whitelistValidation") {
        const safePath = safePropertyPath(propertyPath);
        messages.push(safePath ? `${safePath} 不是允许提交的字段` : "提交内容包含不允许的字段");
        continue;
      }
      if (CHINESE_CHARACTER.test(message)) {
        messages.push(message);
        continue;
      }
      const safePath = safePropertyPath(propertyPath);
      messages.push(safePath ? `${safePath} 填写不正确` : FALLBACK_ERROR_MESSAGE);
    }
    messages.push(...flattenValidationErrors(error.children ?? [], propertyPath));
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
      target: false,
      value: false
    },
    exceptionFactory: createBadRequest
  });
}

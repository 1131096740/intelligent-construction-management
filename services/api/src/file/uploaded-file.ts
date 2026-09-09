import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type Type
} from "@nestjs/common";
import { FileInterceptor as NestFileInterceptor } from "@nestjs/platform-express";

export interface MemoryUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type FileInterceptorOptions = NonNullable<
  Parameters<typeof NestFileInterceptor>[1]
>;
type MulterLimits = NonNullable<FileInterceptorOptions["limits"]> & {
  fieldArrayIndexLimit: number;
};

// All current multipart business forms are flat (file plus scalar metadata), so
// no legitimate route needs a positive bracket-array index. Multer 2.3.0 makes
// this limit available to prevent attacker-controlled sparse-array allocation.
export const MULTIPART_FIELD_ARRAY_INDEX_LIMIT = 0;

const UNSAFE_MULTIPART_FIELD_CODES = new Set([
  "INVALID_FIELD_NAME",
  "LIMIT_FIELD_ARRAY_INDEX",
  "LIMIT_FIELD_NESTING"
]);

export function FileInterceptor(
  fieldName: string,
  localOptions: FileInterceptorOptions = {}
): Type<NestInterceptor> {
  const limits: MulterLimits = {
    ...localOptions.limits,
    fieldArrayIndexLimit: MULTIPART_FIELD_ARRAY_INDEX_LIMIT
  };
  const BaseInterceptor = NestFileInterceptor(fieldName, {
    ...localOptions,
    limits
  });

  class SafeMultipartFileInterceptor extends BaseInterceptor {
    override async intercept(context: ExecutionContext, next: CallHandler) {
      try {
        return await super.intercept(context, next);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        if (UNSAFE_MULTIPART_FIELD_CODES.has(code)) {
          throw new BadRequestException("上传表单结构不正确，请检查后重试");
        }
        throw error;
      }
    }
  }

  return SafeMultipartFileInterceptor;
}

export function normalizeUploadedOriginalName(originalName: string) {
  const decoded = Buffer.from(originalName, "latin1").toString("utf8");
  const looksLikeMojibake = /[\u00c0-\u00ff]/.test(originalName);
  const decodedToChinese = /[\u4e00-\u9fff]/.test(decoded);
  const alreadyChinese = /[\u4e00-\u9fff]/.test(originalName);

  if (
    looksLikeMojibake &&
    decodedToChinese &&
    !alreadyChinese &&
    !decoded.includes("\uFFFD")
  ) {
    return decoded;
  }
  return originalName;
}

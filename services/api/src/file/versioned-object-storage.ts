import { createHash, createHmac } from "node:crypto";
import { Logger } from "@nestjs/common";

/**
 * 版本化对象存储接缝。
 *
 * 只负责「精确对象键」的版本枚举、逐版本删除与收敛证明，以及幂等重试语义。
 * 它不提供桶级生命周期/版本控制配置操作；不把 `uploads/` 等前缀当作删除范围。
 * 生产桶已有版本控制；普通删除只会产生删除标记，因此物理清理必须枚举并逐个
 * 永久删除全部版本与删除标记（COS 对删除标记也必须显式指定 versionId 才能永久移除）。
 *
 * 说明：真实 COS 签名与请求形态在接入生产前须经预检复核（本票不连接生产 COS）。
 */

export interface VersionedObjectInfo {
  objectKey: string;
  versionId: string;
  isDeleteMarker: boolean;
  isLatest: boolean;
  lastModified?: string;
  sizeBytes?: number;
}

export type ObjectStorageOperation = "list_versions" | "delete_version";

export interface ObjectStorageOperationDiagnostics {
  errorCode?: string;
  requestId?: string;
}

export class ObjectStorageOperationError extends Error {
  readonly operation: ObjectStorageOperation;
  readonly retryable: boolean;
  readonly diagnostics: ObjectStorageOperationDiagnostics;

  constructor(input: {
    operation: ObjectStorageOperation;
    retryable: boolean;
    diagnostics?: ObjectStorageOperationDiagnostics;
  }) {
    super(
      input.operation === "list_versions"
        ? "私有对象存储版本枚举失败，请稍后重试或联系管理员"
        : "私有对象存储版本删除失败，请稍后重试或联系管理员"
    );
    this.name = "ObjectStorageOperationError";
    this.operation = input.operation;
    this.retryable = input.retryable;
    this.diagnostics = input.diagnostics ?? {};
  }
}

export interface VersionedObjectStorage {
  /** 返回精确键的全部对象版本与删除标记（不含其他键）。 */
  listObjectVersions(objectKey: string): Promise<VersionedObjectInfo[]>;
  /** 永久删除精确键的指定版本/删除标记；对已不存在的版本视为已收敛。 */
  deleteObjectVersion(objectKey: string, versionId: string): Promise<void>;
  /** 新鲜枚举证明无任何版本或删除标记残留。 */
  isConverged(objectKey: string): Promise<boolean>;
}

export interface ObjectStorageRetryOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function withObjectStorageRetry<T>(
  operation: () => Promise<T>,
  options: ObjectStorageRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 50;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable =
        options.shouldRetry?.(error) ??
        (error instanceof ObjectStorageOperationError ? error.retryable : false);
      if (!retryable) {
        throw error;
      }
      if (attempt < maxAttempts) {
        await sleep(baseBackoffMs * 2 ** (attempt - 1));
      }
    }
  }
  // 最后一次尝试仍失败（可重试错误）时兜底抛回最近一次错误。
  throw lastError;
}

function extractTagBlock(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (const match of xml.matchAll(pattern)) {
    blocks.push(match[1]);
  }
  return blocks;
}

function extractTagValue(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1]?.trim();
}

export function isValidObjectKey(objectKey: string): boolean {
  if (!objectKey.trim() || objectKey.includes("\0") || objectKey.includes("\\")) {
    return false;
  }
  const segments = objectKey.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/**
 * 判定 COS HTTP 状态是否值得重试：仅服务端错误（5xx）与限流（429）可重试，
 * 其余 4xx（如 403/400/404/405）为确定性错误，重试不会成功。
 */
function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function encodeQueryValue(value: string): string {
  // COS 签名的 URL 编码：/ : 等特殊字符也必须编码（与 encodeURIComponent 一致）。
  return encodeURIComponent(value);
}

/** 生成与签名一致的请求 URL：参数按编码后 key 排序，标志参数保留空值。 */
function buildObjectStorageUrl(
  host: string,
  pathname: string,
  query: Record<string, string | undefined>
): string {
  const base = `https://${host}${pathname === "/" ? "/" : encodeURI(pathname)}`;
  const parts = sortedQueryEntries(query).map(({ encodedKey, encodedValue }) =>
    encodedValue === "" ? encodedKey : `${encodedKey}=${encodedValue}`
  );
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

interface SortedQueryEntry {
  rawKey: string;
  encodedKey: string;
  encodedValue: string;
}

function sortedQueryEntries(
  query: Record<string, string | undefined>
): SortedQueryEntry[] {
  return Object.entries(query)
    .map(([rawKey, rawValue]) => ({
      rawKey,
      encodedKey: encodeQueryValue(rawKey.toLowerCase()),
      encodedValue: rawValue === undefined ? "" : encodeQueryValue(rawValue)
    }))
    .sort((left, right) => left.encodedKey.localeCompare(right.encodedKey));
}

function cosSignedAuthorization(
  method: string,
  pathname: string,
  host: string,
  query: Record<string, string | undefined>,
  secretId: string,
  secretKey: string,
  nowEpochSeconds: number
): string {
  const keyTime = `${nowEpochSeconds};${nowEpochSeconds + 600}`;
  const entries = sortedQueryEntries(query);
  const urlParamList = entries.map((entry) => entry.encodedKey).join(";");
  const httpParameters = entries
    .map((entry) => `${entry.encodedKey}=${entry.encodedValue}`)
    .join("&");
  const httpString = [
    method.toLowerCase(),
    pathname,
    httpParameters,
    `host=${encodeURIComponent(host)}`,
    ""
  ].join("\n");
  const stringToSign = [
    "sha1",
    keyTime,
    createHash("sha1").update(httpString).digest("hex"),
    ""
  ].join("\n");
  const signKey = createHmac("sha1", secretKey).update(keyTime).digest("hex");
  const signature = createHmac("sha1", signKey).update(stringToSign).digest("hex");

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    "q-header-list=host",
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`
  ].join("&");
}

export interface CosVersionedObjectStorageOptions {
  fetchImpl?: typeof fetch;
}

/**
 * 基于 COS XML API 的版本化存储适配器。
 *
 * - 版本枚举：`GET /?versions&prefix=<精确键>&max-keys=1000`，按 key-marker / version-id-marker 分页，
 *   仅保留 `<Key>` 与精确键一致的 `<Version>` / `<DeleteMarker>`。
 * - 逐版本删除：`DELETE /<键>?versionId=<版本ID>`，404 视为已收敛。
 * - 收敛证明：删除后重新枚举，无任何版本/删除标记残留才算完成。
 */
export class CosVersionedObjectStorage implements VersionedObjectStorage {
  private readonly logger = new Logger(CosVersionedObjectStorage.name);
  private readonly fetchImpl: typeof fetch;

  constructor(options: CosVersionedObjectStorageOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async listObjectVersions(objectKey: string): Promise<VersionedObjectInfo[]> {
    this.assertValidObjectKey(objectKey);
    const collected: VersionedObjectInfo[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let truncated = true;
    while (truncated) {
      const page = await this.listVersionsPage(objectKey, keyMarker, versionIdMarker);
      collected.push(...page.infos);
      truncated = page.isTruncated;
      keyMarker = page.nextKeyMarker;
      versionIdMarker = page.nextVersionIdMarker;
    }
    return collected;
  }

  async deleteObjectVersion(objectKey: string, versionId: string): Promise<void> {
    this.assertValidObjectKey(objectKey);
    if (!versionId.trim()) {
      throw new ObjectStorageOperationError({
        operation: "delete_version",
        retryable: false,
        diagnostics: { errorCode: "MissingVersionId" }
      });
    }
    const bucket = this.requiredEnv("COS_BUCKET");
    const region = this.requiredEnv("COS_REGION");
    const host = `${bucket}.cos.${region}.myqcloud.com`;
    const pathname = `/${objectKey}`;
    const query = { versionId };
    const requestUrl = buildObjectStorageUrl(host, pathname, query);
    const headers = {
      Authorization: this.authorization("DELETE", pathname, host, query),
      Host: host
    };

    let response: Response;
    try {
      response = await this.fetchImpl(requestUrl, { method: "DELETE", headers });
    } catch {
      this.logFailure("delete_version", "传输失败", undefined, objectKey);
      throw new ObjectStorageOperationError({ operation: "delete_version", retryable: true });
    }
    if (response.status === 404) {
      return;
    }
    if (!response.ok) {
      const diagnostics = await this.responseDiagnostics(response);
      this.logFailure("delete_version", response.status, diagnostics, objectKey);
      throw new ObjectStorageOperationError({
        operation: "delete_version",
        retryable: isRetryableHttpStatus(response.status),
        diagnostics
      });
    }
  }

  async isConverged(objectKey: string): Promise<boolean> {
    const versions = await this.listObjectVersions(objectKey);
    return versions.length === 0;
  }

  private async listVersionsPage(
    objectKey: string,
    keyMarker: string | undefined,
    versionIdMarker: string | undefined
  ): Promise<{
    infos: VersionedObjectInfo[];
    isTruncated: boolean;
    nextKeyMarker: string | undefined;
    nextVersionIdMarker: string | undefined;
  }> {
    const bucket = this.requiredEnv("COS_BUCKET");
    const region = this.requiredEnv("COS_REGION");
    const host = `${bucket}.cos.${region}.myqcloud.com`;
    const pathname = "/";
    const query: Record<string, string | undefined> = {
      versions: undefined,
      prefix: objectKey,
      "max-keys": "1000"
    };
    if (keyMarker) {
      query["key-marker"] = keyMarker;
    }
    if (versionIdMarker) {
      query["version-id-marker"] = versionIdMarker;
    }
    const requestUrl = buildObjectStorageUrl(host, pathname, query);
    const headers = {
      Authorization: this.authorization("GET", pathname, host, query),
      Host: host
    };

    let response: Response;
    try {
      response = await this.fetchImpl(requestUrl, { method: "GET", headers });
    } catch {
      this.logFailure("list_versions", "传输失败", undefined, objectKey);
      throw new ObjectStorageOperationError({ operation: "list_versions", retryable: true });
    }
    if (!response.ok) {
      const diagnostics = await this.responseDiagnostics(response);
      this.logFailure("list_versions", response.status, diagnostics, objectKey);
      throw new ObjectStorageOperationError({
        operation: "list_versions",
        retryable: isRetryableHttpStatus(response.status),
        diagnostics
      });
    }
    const xml = await response.text();
    return this.parseListVersionsResult(xml, objectKey);
  }

  private parseListVersionsResult(
    xml: string,
    exactKey: string
  ): {
    infos: VersionedObjectInfo[];
    isTruncated: boolean;
    nextKeyMarker: string | undefined;
    nextVersionIdMarker: string | undefined;
  } {
    const infos: VersionedObjectInfo[] = [];
    for (const block of extractTagBlock(xml, "Version")) {
      const key = extractTagValue(block, "Key");
      const versionId = extractTagValue(block, "VersionId");
      if (key === exactKey && versionId) {
        infos.push({
          objectKey: exactKey,
          versionId,
          isDeleteMarker: false,
          isLatest: extractTagValue(block, "IsLatest") === "true",
          lastModified: extractTagValue(block, "LastModified"),
          sizeBytes: toOptionalInteger(extractTagValue(block, "Size"))
        });
      }
    }
    for (const block of extractTagBlock(xml, "DeleteMarker")) {
      const key = extractTagValue(block, "Key");
      const versionId = extractTagValue(block, "VersionId");
      if (key === exactKey && versionId) {
        infos.push({
          objectKey: exactKey,
          versionId,
          isDeleteMarker: true,
          isLatest: extractTagValue(block, "IsLatest") === "true",
          lastModified: extractTagValue(block, "LastModified")
        });
      }
    }
    return {
      infos,
      isTruncated: extractTagValue(xml, "IsTruncated") === "true",
      nextKeyMarker: extractTagValue(xml, "NextKeyMarker"),
      nextVersionIdMarker: extractTagValue(xml, "NextVersionIdMarker")
    };
  }

  private authorization(
    method: "DELETE" | "GET",
    pathname: string,
    host: string,
    query: Record<string, string | undefined>
  ): string {
    return cosSignedAuthorization(
      method,
      pathname,
      host,
      query,
      this.requiredEnv("COS_SECRET_ID"),
      this.requiredEnv("COS_SECRET_KEY"),
      Math.floor(Date.now() / 1000)
    );
  }

  private assertValidObjectKey(objectKey: string): void {
    if (!isValidObjectKey(objectKey)) {
      throw new ObjectStorageOperationError({
        operation: "list_versions",
        retryable: false,
        diagnostics: { errorCode: "InvalidObjectKey" }
      });
    }
  }

  private objectKeyFingerprint(objectKey: string): string {
    return createHash("sha256").update(objectKey).digest("hex").slice(0, 16);
  }

  private logFailure(
    operation: ObjectStorageOperation,
    statusOrFailure: number | string,
    diagnostics: ObjectStorageOperationDiagnostics | undefined,
    objectKey: string
  ): void {
    this.logger.error({
      event: "versioned_object_storage_request_failed",
      operation,
      statusCode: typeof statusOrFailure === "number" ? statusOrFailure : undefined,
      failureType: typeof statusOrFailure === "string" ? statusOrFailure : undefined,
      cosErrorCode: diagnostics?.errorCode,
      cosRequestId: diagnostics?.requestId,
      objectKeyFingerprint: this.objectKeyFingerprint(objectKey)
    });
  }

  private async responseDiagnostics(
    response: Response
  ): Promise<ObjectStorageOperationDiagnostics> {
    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      // 保留稳定诊断信息，不因不可读错误体而失败。
    }
    const headerRequestId =
      typeof response.headers?.get === "function"
        ? response.headers.get("x-cos-request-id") ?? undefined
        : undefined;
    return {
      errorCode: extractTagValue(responseText, "Code"),
      requestId:
        sanitizeCosDiagnostic(headerRequestId) ??
        sanitizeCosDiagnostic(extractTagValue(responseText, "RequestId"))
    };
  }

  private requiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`${key} is required for versioned COS operations`);
    }
    return value;
  }
}

function sanitizeCosDiagnostic(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9._:/+=-]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function toOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && String(parsed) === value ? parsed : undefined;
}

export interface InMemoryVersionedObjectStorageState {
  /** objectKey -> 全部版本/删除标记（按 seed 顺序）。 */
  versions: Map<string, VersionedObjectInfo[]>;
  failNextList: number;
  failNextDelete: number;
  nonce: number;
}

export interface SeedVersion {
  versionId?: string;
  isDeleteMarker?: boolean;
  isLatest?: boolean;
  lastModified?: string;
  sizeBytes?: number;
}

/**
 * 确定性内存伪实现：仅用于单元/集成测试，模拟版本化 COS 的列举、删除、收敛、
 * 幂等与邻接键隔离语义；绝不连接生产桶。
 */
export class InMemoryVersionedObjectStorage implements VersionedObjectStorage {
  readonly state: InMemoryVersionedObjectStorageState;

  constructor(
    state: InMemoryVersionedObjectStorageState = {
      versions: new Map(),
      failNextList: 0,
      failNextDelete: 0,
      nonce: 0
    }
  ) {
    this.state = state;
  }

  seed(objectKey: string, versions: SeedVersion[]): void {
    const entries = versions.map((version, index) => ({
      objectKey,
      versionId: version.versionId ?? `ver-${this.state.nonce++}-${index}`,
      isDeleteMarker: version.isDeleteMarker ?? false,
      isLatest: version.isLatest ?? false,
      lastModified: version.lastModified,
      sizeBytes: version.sizeBytes
    }));
    this.state.versions.set(objectKey, entries);
  }

  simulateNextListFailure(): void {
    this.state.failNextList += 1;
  }

  simulateNextDeleteFailure(): void {
    this.state.failNextDelete += 1;
  }

  async listObjectVersions(objectKey: string): Promise<VersionedObjectInfo[]> {
    if (this.state.failNextList > 0) {
      this.state.failNextList -= 1;
      throw new ObjectStorageOperationError({ operation: "list_versions", retryable: true });
    }
    return [...(this.state.versions.get(objectKey) ?? [])];
  }

  async deleteObjectVersion(objectKey: string, versionId: string): Promise<void> {
    if (this.state.failNextDelete > 0) {
      this.state.failNextDelete -= 1;
      throw new ObjectStorageOperationError({ operation: "delete_version", retryable: true });
    }
    const entries = this.state.versions.get(objectKey);
    if (!entries) {
      return;
    }
    const remaining = entries.filter((entry) => entry.versionId !== versionId);
    if (remaining.length === 0) {
      this.state.versions.delete(objectKey);
    } else {
      this.state.versions.set(objectKey, remaining);
    }
  }

  async isConverged(objectKey: string): Promise<boolean> {
    const versions = await this.listObjectVersions(objectKey);
    return versions.length === 0;
  }
}

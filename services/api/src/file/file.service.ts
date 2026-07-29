import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnModuleInit
} from "@nestjs/common";
import { type FileObject, Prisma } from "@prisma/client";
import {
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { SpotProcurementAccessService } from "../spot-procurement/spot-procurement-access.service";
import { SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY } from "../spot-procurement/spot-procurement-form-renderer";
import {
  acquireFileBusinessBindingTransactionLock,
  hasNonReceiptBusinessFileBinding,
  nonReceiptBusinessFileBindingIds
} from "./file-business-binding";

export interface UploadPrivateFileInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  buffer: Buffer;
  approvalFormGenerationClaim?: {
    approvalInstanceId: string;
    claimToken: string;
  };
  settlementSignedDocumentGenerationClaim?: {
    settlementId: string;
    claimToken: string;
  };
}

export interface ReadPrivateFileInput {
  actorUserId: string;
  expiresAt: string;
  token: string;
  downloadReason?: string;
  accessMode?: FileTicketAccessMode;
}

export type FileTicketAccessMode = "download" | "preview";

export interface CreateFileDownloadTicketInput {
  actorUserId: string;
  downloadReason?: string;
  accessMode?: FileTicketAccessMode;
}

export interface LinkFileReplacementInput {
  newFileId: string;
  oldFileId: string;
  actorUserId: string;
}

export interface InternalFileBuffer {
  file: FileObject;
  buffer: Buffer;
}

type LockedFileReplacementRow = Pick<
  FileObject,
  "id" | "uploadedByUserId" | "storageStatus" | "supersedesFileObjectId"
>;
type LockedGeneratedFileRow = Pick<
  FileObject,
  "id" | "uploadedByUserId" | "storageStatus"
>;
type LockedUnboundFileRow = Pick<
  FileObject,
  "id" | "mimeType" | "uploadedByUserId" | "storageStatus"
>;

const FILE_ALREADY_BOUND_MESSAGE = "该文件已绑定其他业务记录，不能重复使用";
const REFUND_VOUCHER_BINDING = [
  { table: "SpotProcurementRefund", column: "voucherFileId" }
] as const;
const INVOICE_RECORD_FILE_BINDING = [
  { table: "InvoiceRecord", column: "fileId" }
] as const;
const SPOT_PAYMENT_INVOICE_FILE_BINDING = [
  { table: "SpotProcurementPaymentInvoice", column: "fileId" }
] as const;
const NO_INVOICE_PROOF_BINDING = [
  { table: "NoInvoiceConfirmation", column: "proofFileId" }
] as const;
const INVOICE_EXCEPTION_PROOF_BINDING = [
  { table: "InvoiceExceptionConfirmation", column: "proofFileId" }
] as const;

const ARCHIVE_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = [
  "contract_staff",
  "contract_director",
  "finance_staff",
  "finance_director"
];
const PAYMENT_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = ["finance_staff", "finance_director"];
const UPSTREAM_SETTLEMENT_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = ["budget_staff", "budget_director"];
const AFFILIATE_CONTRACT_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = [
  "contract_staff",
  "contract_director"
];
const AFFILIATE_SETTLEMENT_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = ["budget_staff"];
const SETTLEMENT_EXCEPTION_QUOTA_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = [
  "project_manager",
  "contract_director",
  "budget_director",
  "chairman",
  "general_manager"
];
const PROJECT_FINANCING_QUOTA_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = [
  "project_manager",
  "finance_director",
  "chairman",
  "general_manager"
];
const PROJECT_EXPENSE_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = [
  "project_manager",
  "contract_director",
  "budget_director",
  "material_director",
  "engineering_director",
  "comprehensive_director",
  "finance_director",
  "chairman",
  "general_manager"
];
const ALLOWED_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg"
]);
const INVALID_PRIVATE_FILE_PATH_MESSAGE = "私有文件路径无效，系统已阻止本次文件读取。";

class InvalidPrivateFilePathError extends Error {
  constructor() {
    super(INVALID_PRIVATE_FILE_PATH_MESSAGE);
  }
}

function roleKeysFromApprovalFrozenNodes(frozenNodes: unknown): RoleKey[] {
  if (!Array.isArray(frozenNodes)) {
    return [];
  }

  const roleKeys = new Set<RoleKey>();
  frozenNodes.forEach((node) => {
    if (!node || typeof node !== "object") {
      return;
    }
    const nodeRoleKeys = (node as { roleKeys?: unknown }).roleKeys;
    if (!Array.isArray(nodeRoleKeys)) {
      return;
    }
    nodeRoleKeys.forEach((roleKey) => {
      if (typeof roleKey === "string" && roleKey.trim()) {
        roleKeys.add(roleKey as RoleKey);
      }
    });
  });

  return Array.from(roleKeys);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

@Injectable()
export class PrivateFileStorage implements OnModuleInit {
  private readonly logger = new Logger(PrivateFileStorage.name);
  private readonly configuredRoot = process.env.FILE_STORAGE_ROOT;
  private readonly root = resolve(
    this.configuredRoot ?? join(process.cwd(), "storage", "private")
  );

  onModuleInit() {
    this.assertConfigured();
  }

  assertConfigured() {
    if (this.useCos()) {
      const requiredKeys = [
        "COS_BUCKET",
        "COS_REGION",
        "COS_SECRET_ID",
        "COS_SECRET_KEY"
      ] as const;
      const missingKeys = requiredKeys.filter((key) => !process.env[key]?.trim());
      if (missingKeys.length) {
        throw new Error(`私有对象存储配置缺失：${missingKeys.join("、")}`);
      }
      return;
    }

    if (
      (this.configuredRoot !== undefined && !this.configuredRoot.trim()) ||
      this.root.includes("\0") ||
      this.root === parse(this.root).root ||
      this.root === resolve(process.cwd())
    ) {
      throw new Error("FILE_STORAGE_ROOT 配置不安全，请设置为专用私有文件目录");
    }

    this.resolveObjectKey(".storage-config-check");
  }

  async write(objectKey: string, buffer: Buffer) {
    this.resolveObjectKey(objectKey);
    if (this.useCos()) {
      await this.cosRequest("PUT", objectKey, buffer);
      return;
    }

    const { parent, target } = await this.resolveLocalTarget(objectKey, true, "write");
    let canonicalParent: string;
    try {
      canonicalParent = await realpath(parent);
    } catch {
      throw new Error("本地文件存储路径校验失败");
    }
    await this.assertCanonicalLocalPath(parent, canonicalParent, true);

    try {
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink()) {
        throw new InvalidPrivateFilePathError();
      }
      if (!targetStat.isFile()) {
        throw new Error("本地文件写入失败");
      }
    } catch (error) {
      if (error instanceof InvalidPrivateFilePathError) throw error;
      if (!isFileNotFoundError(error)) {
        throw new Error("本地文件写入失败");
      }
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        target,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_TRUNC |
          fsConstants.O_NOFOLLOW,
        0o600
      );
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) {
        throw new Error("本地文件写入失败");
      }
      await handle.writeFile(buffer);
    } catch (error) {
      if (hasErrorCode(error, "ELOOP")) {
        throw new InvalidPrivateFilePathError();
      }
      if (error instanceof InvalidPrivateFilePathError) throw error;
      throw new Error("本地文件写入失败");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async read(objectKey: string) {
    this.resolveObjectKey(objectKey);
    if (this.useCos()) {
      return this.cosRequest("GET", objectKey);
    }

    const { target } = await this.resolveLocalTarget(objectKey, false, "read");
    let canonicalTarget: string;
    try {
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink()) {
        throw new InvalidPrivateFilePathError();
      }
      if (!targetStat.isFile()) {
        throw new Error("本地文件读取失败");
      }
      canonicalTarget = await realpath(target);
    } catch (error) {
      if (error instanceof InvalidPrivateFilePathError) throw error;
      throw new Error("本地文件读取失败");
    }

    await this.assertCanonicalLocalPath(target, canonicalTarget, false);

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(canonicalTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) {
        throw new Error("本地文件读取失败");
      }
      return await handle.readFile();
    } catch (error) {
      if (hasErrorCode(error, "ELOOP")) {
        throw new InvalidPrivateFilePathError();
      }
      if (error instanceof InvalidPrivateFilePathError) throw error;
      throw new Error("本地文件读取失败");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async delete(objectKey: string): Promise<void> {
    const target = this.resolveObjectKey(objectKey);
    if (this.useCos()) {
      await this.cosRequest("DELETE", objectKey);
      return;
    }

    let canonicalRoot: string;
    let canonicalTarget: string;
    try {
      canonicalRoot = await realpath(this.root);
      canonicalTarget = await realpath(target);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return;
      }
      throw new Error("本地文件存储路径校验失败");
    }

    const relativeTarget = relative(canonicalRoot, canonicalTarget);
    if (
      !relativeTarget ||
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      throw new Error("私有文件路径无效，系统已阻止本次文件读取。");
    }

    try {
      await rm(canonicalTarget, { force: true });
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return;
      }
      throw new Error("本地文件删除失败");
    }
  }

  bucketName() {
    return this.useCos() ? this.requiredEnv("COS_BUCKET") : "private-local";
  }

  private resolveObjectKey(objectKey: string) {
    const segments = objectKey.split("/");
    if (
      !objectKey.trim() ||
      objectKey.includes("\0") ||
      objectKey.includes("\\") ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error(INVALID_PRIVATE_FILE_PATH_MESSAGE);
    }

    const target = resolve(this.root, objectKey);
    const rootPrefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (target === this.root || !target.startsWith(rootPrefix)) {
      throw new Error(INVALID_PRIVATE_FILE_PATH_MESSAGE);
    }

    return target;
  }

  private async resolveLocalTarget(
    objectKey: string,
    createParents: boolean,
    operation: "read" | "write"
  ) {
    const segments = objectKey.split("/");
    const operationErrorMessage = operation === "read" ? "本地文件读取失败" : "本地文件写入失败";
    let canonicalRoot: string;
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      canonicalRoot = await realpath(this.root);
      const rootStat = await lstat(canonicalRoot);
      if (!rootStat.isDirectory()) {
        throw new Error("not-directory");
      }
    } catch {
      throw new Error("本地文件存储路径校验失败");
    }

    let parent = canonicalRoot;
    for (const segment of segments.slice(0, -1)) {
      const directory = join(parent, segment);
      let directoryStat;
      try {
        directoryStat = await lstat(directory);
      } catch (error) {
        if (!createParents || !isFileNotFoundError(error)) {
          throw new Error(operationErrorMessage);
        }

        try {
          await mkdir(directory, { mode: 0o700 });
        } catch (mkdirError) {
          if (!hasErrorCode(mkdirError, "EEXIST")) {
            throw new Error(operationErrorMessage);
          }
        }

        try {
          directoryStat = await lstat(directory);
        } catch {
          throw new Error(operationErrorMessage);
        }
      }

      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new InvalidPrivateFilePathError();
      }

      let canonicalDirectory: string;
      try {
        canonicalDirectory = await realpath(directory);
      } catch {
        throw new Error("本地文件存储路径校验失败");
      }
      await this.assertCanonicalLocalPath(directory, canonicalDirectory, true, canonicalRoot);
      parent = canonicalDirectory;
    }

    return { parent, target: join(parent, segments.at(-1)!) };
  }

  private async assertCanonicalLocalPath(
    expectedPath: string,
    canonicalPath: string,
    allowRoot: boolean,
    knownCanonicalRoot?: string
  ) {
    let canonicalRoot = knownCanonicalRoot;
    if (!canonicalRoot) {
      try {
        canonicalRoot = await realpath(this.root);
      } catch {
        throw new Error("本地文件存储路径校验失败");
      }
    }

    const relativeTarget = relative(canonicalRoot, canonicalPath);
    if (
      canonicalPath !== expectedPath ||
      (!allowRoot && !relativeTarget) ||
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      throw new InvalidPrivateFilePathError();
    }
  }

  private useCos() {
    return process.env.FILE_STORAGE_DRIVER === "cos";
  }

  private async cosRequest(method: "DELETE" | "GET" | "PUT", objectKey: string, body?: Buffer) {
    // ponytail: direct COS XML operations; switch to SDK when multipart/resumable upload matters.
    const bucket = this.requiredEnv("COS_BUCKET");
    const region = this.requiredEnv("COS_REGION");
    const host = `${bucket}.cos.${region}.myqcloud.com`;
    const canonicalPath = `/${objectKey}`;
    const requestPath = encodeURI(canonicalPath);
    let response: Response;
    try {
      response = await fetch(`https://${host}${requestPath}`, {
        method,
        headers: {
          Authorization: this.cosAuthorization(method, canonicalPath, host),
          Host: host
        },
        body: body ? new Uint8Array(body) : undefined
      });
    } catch {
      this.logger.error({
        event: "private_file_cos_request_failed",
        operation: this.cosOperationName(method),
        failureType: "传输失败",
        objectKeyFingerprint: this.objectKeyFingerprint(objectKey)
      });
      throw new Error(this.cosFailureMessage(method));
    }

    if (!response.ok && !(method === "DELETE" && response.status === 404)) {
      const diagnostics = await this.cosResponseDiagnostics(response);
      this.logger.error({
        event: "private_file_cos_request_failed",
        operation: this.cosOperationName(method),
        statusCode: response.status,
        cosErrorCode: diagnostics.errorCode,
        cosRequestId: diagnostics.requestId,
        objectKeyFingerprint: this.objectKeyFingerprint(objectKey)
      });
      throw new Error(this.cosFailureMessage(method));
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private cosFailureMessage(method: "DELETE" | "GET" | "PUT") {
    return method === "PUT"
      ? "私有文件上传到对象存储失败，请稍后重试或联系管理员"
      : method === "GET"
        ? "资料文件暂时无法从对象存储读取，请稍后重试或联系管理员"
        : "私有文件从对象存储删除失败，请稍后重试或联系管理员";
  }

  private cosOperationName(method: "DELETE" | "GET" | "PUT") {
    return method === "PUT" ? "上传" : method === "GET" ? "读取" : "删除";
  }

  private objectKeyFingerprint(objectKey: string) {
    return createHash("sha256").update(objectKey).digest("hex").slice(0, 16);
  }

  private async cosResponseDiagnostics(response: Response) {
    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      // Keep the public error stable even when COS returns an unreadable error body.
    }

    const headerRequestId =
      typeof response.headers?.get === "function"
        ? response.headers.get("x-cos-request-id")
        : undefined;
    return {
      errorCode: this.cosDiagnosticValue(responseText, "Code"),
      requestId:
        this.sanitizeCosDiagnostic(headerRequestId) ??
        this.cosDiagnosticValue(responseText, "RequestId")
    };
  }

  private cosDiagnosticValue(responseText: string, tag: "Code" | "RequestId") {
    const match = responseText.match(new RegExp(`<${tag}>\\s*([^<]{1,160})\\s*</${tag}>`, "i"));
    return this.sanitizeCosDiagnostic(match?.[1]);
  }

  private sanitizeCosDiagnostic(value: string | null | undefined) {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9._:/+=-]+$/.test(normalized)) {
      return undefined;
    }
    return normalized;
  }

  private cosAuthorization(method: "DELETE" | "GET" | "PUT", pathname: string, host: string) {
    const secretId = this.requiredEnv("COS_SECRET_ID");
    const secretKey = this.requiredEnv("COS_SECRET_KEY");
    const now = Math.floor(Date.now() / 1000);
    const keyTime = `${now};${now + 600}`;
    const headerList = "host";
    const httpString = [
      method.toLowerCase(),
      pathname,
      "",
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
      `q-header-list=${headerList}`,
      "q-url-param-list=",
      `q-signature=${signature}`
    ].join("&");
  }

  private requiredEnv(key: string) {
    const value = process.env[key];
    if (!value) {
      throw new Error(`${key} is required for COS private storage`);
    }

    return value;
  }
}

function normalizeDownloadReason(value: string | undefined): string {
  const reason = value?.trim();
  if (!reason) {
    throw new BadRequestException("请填写下载原因，便于留痕审计");
  }
  if (reason.length > 200) {
    throw new BadRequestException("下载原因不能超过 200 个字，请精简后重新提交");
  }
  return reason;
}

const SAFE_ERROR_FACT = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function safeErrorSummary(error: unknown, stage: string) {
  const source =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const name =
    typeof source?.name === "string" && SAFE_ERROR_FACT.test(source.name)
      ? source.name
      : "UnknownError";
  const code =
    typeof source?.code === "string" && SAFE_ERROR_FACT.test(source.code)
      ? source.code
      : undefined;

  return code ? { stage, name, code } : { stage, name };
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    private readonly storage: PrivateFileStorage = new PrivateFileStorage(),
    private readonly spotAccess: SpotProcurementAccessService =
      new SpotProcurementAccessService(prisma)
  ) {
    this.assertDownloadSecret();
  }

  private objectKeyFingerprint(objectKey: string) {
    return createHash("sha256").update(objectKey).digest("hex").slice(0, 16);
  }

  async uploadPrivateFile(input: UploadPrivateFileInput) {
    if (!input.uploadedByUserId.trim()) {
      throw new Error("上传人信息缺失，请重新登录后再上传资料");
    }

    if (!input.buffer.length || input.sizeBytes <= 0) {
      throw new Error("上传文件为空，请重新选择资料文件");
    }

    if (input.sizeBytes > Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)) {
      throw new Error("上传文件超过系统限制，请压缩后重新上传或联系管理员");
    }

    if (!ALLOWED_EXTENSIONS.has(extname(input.originalName).toLowerCase())) {
      throw new Error("文件格式不支持，请上传 PDF、Word、Excel 或图片资料");
    }

    const settlementClaimToken = input.settlementSignedDocumentGenerationClaim?.claimToken;
    if (settlementClaimToken && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(settlementClaimToken)) {
      throw new BadRequestException("结算签名合成任务令牌无效，请重新发起生成");
    }
    const objectKey = settlementClaimToken
      ? `uploads/settlement-signed-generation/${settlementClaimToken}.pdf`
      : `uploads/${randomUUID()}-${this.safeFileName(input.originalName)}`;
    const fileId = randomUUID();
    const contentSha256 = createHash("sha256").update(input.buffer).digest("hex");
    await this.storage.write(objectKey, input.buffer);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const file = await tx.fileObject.create({
          data: {
            id: fileId,
            bucket: this.storage.bucketName(),
            objectKey,
            originalName: input.originalName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            uploadedByUserId: input.uploadedByUserId,
            contentSha256,
            storageStatus: "active",
            supersedesFileObjectId: null
          }
        });

        await this.audit.record(tx, {
          actorUserId: input.uploadedByUserId,
          action: "file.upload",
          businessType: "file_object",
          businessId: file.id,
          metadata: {
            bucket: file.bucket,
            objectKey: file.objectKey,
            originalName: file.originalName,
            sizeBytes: file.sizeBytes
          }
        });

        if (input.approvalFormGenerationClaim) {
          const claimed = await tx.approvalFormGenerationClaim.updateMany({
            where: {
              approvalInstanceId: input.approvalFormGenerationClaim.approvalInstanceId,
              claimToken: input.approvalFormGenerationClaim.claimToken,
              status: "pending",
              uploadedFileId: null
            },
            data: {
              status: "uploaded",
              uploadedFileId: file.id,
              safeFailureCode: null
            }
          });
          if (claimed.count !== 1) {
            throw new Error("审批单生成权已变化，请稍后重试");
          }
        }

        if (input.settlementSignedDocumentGenerationClaim) {
          const claim = input.settlementSignedDocumentGenerationClaim;
          const claimed = await tx.settlementSignedDocumentGenerationClaim.updateMany({
            where: {
              settlementId: claim.settlementId,
              claimToken: claim.claimToken,
              status: "pending",
              uploadedFileId: null
            },
            data: { status: "uploaded", uploadedFileId: file.id, safeFailureCode: null }
          });
          if (claimed.count !== 1) {
            throw new Error("结算签名合成件生成权已变化，请刷新后重试");
          }
        }

        return file;
      });
    } catch (transactionError) {
      let committedFile: FileObject | null;
      try {
        committedFile = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
        if (committedFile) {
          const fileMatches =
            committedFile.objectKey === objectKey &&
            committedFile.contentSha256 === contentSha256 &&
            committedFile.uploadedByUserId === input.uploadedByUserId &&
            committedFile.storageStatus === "active";
          const [approvalClaim, settlementClaim] = await Promise.all([
            input.approvalFormGenerationClaim
              ? this.prisma.approvalFormGenerationClaim.findFirst({
                  where: {
                    approvalInstanceId: input.approvalFormGenerationClaim.approvalInstanceId,
                    claimToken: input.approvalFormGenerationClaim.claimToken,
                    uploadedFileId: fileId
                  },
                  select: { approvalInstanceId: true }
                })
              : Promise.resolve({ approvalInstanceId: "not-required" }),
            input.settlementSignedDocumentGenerationClaim
              ? this.prisma.settlementSignedDocumentGenerationClaim.findFirst({
                  where: {
                    settlementId: input.settlementSignedDocumentGenerationClaim.settlementId,
                    claimToken: input.settlementSignedDocumentGenerationClaim.claimToken,
                    uploadedFileId: fileId
                  },
                  select: { settlementId: true }
                })
              : Promise.resolve({ settlementId: "not-required" })
          ]);
          if (fileMatches && approvalClaim && settlementClaim) return committedFile;
          this.logger.error({
            event: "private_file_registration_commit_ambiguous",
            fileId,
            objectKeyFingerprint: this.objectKeyFingerprint(objectKey),
            transactionError: safeErrorSummary(transactionError, "database_transaction")
          });
          throw new InternalServerErrorException("文件登记结果暂时无法确认，请稍后刷新重试");
        }
      } catch (verificationError) {
        if (verificationError instanceof InternalServerErrorException) throw verificationError;
        this.logger.error({
          event: "private_file_registration_verification_failed",
          fileId,
          objectKeyFingerprint: this.objectKeyFingerprint(objectKey),
          transactionError: safeErrorSummary(transactionError, "database_transaction"),
          verificationError: safeErrorSummary(verificationError, "commit_verification")
        });
        throw new InternalServerErrorException("文件登记结果暂时无法确认，请稍后刷新重试");
      }
      try {
        await this.storage.delete(objectKey);
      } catch (cleanupError) {
        this.logger.error({
          event: "private_file_registration_cleanup_failed",
          objectKeyFingerprint: this.objectKeyFingerprint(objectKey),
          transactionError: safeErrorSummary(transactionError, "database_transaction"),
          cleanupError: safeErrorSummary(cleanupError, "orphan_cleanup")
        });
        throw new InternalServerErrorException("文件登记失败且存储清理未完成");
      }
      throw transactionError;
    }
  }

  // 仅供已完成业务权限校验的内部服务在同一事务中接入替换链。
  async linkFileReplacement(
    tx: Prisma.TransactionClient,
    input: LinkFileReplacementInput
  ): Promise<void> {
    if (input.newFileId === input.oldFileId) {
      throw new BadRequestException("新旧文件不能为同一文件");
    }

    await acquireFileBusinessBindingTransactionLock(tx);
    const initialFileIds = [input.newFileId, input.oldFileId].sort();
    const initialFiles = await tx.$queryRaw<LockedFileReplacementRow[]>(Prisma.sql`
      SELECT "id", "uploadedByUserId", "storageStatus", "supersedesFileObjectId"
      FROM "FileObject"
      WHERE "id" IN (${Prisma.join(initialFileIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const lockedFilesById = new Map(initialFiles.map((file) => [file.id, file]));
    const newFile = lockedFilesById.get(input.newFileId);
    const oldFile = lockedFilesById.get(input.oldFileId);

    if (!newFile || !oldFile) {
      throw new BadRequestException("新文件或被替换文件不存在");
    }
    if (newFile.storageStatus !== "active" || oldFile.storageStatus !== "active") {
      throw new BadRequestException("新旧文件必须处于可用状态");
    }
    if (newFile.uploadedByUserId !== input.actorUserId) {
      throw new ForbiddenException("当前账号无权接入该文件替换链");
    }
    if (
      newFile.supersedesFileObjectId !== null &&
      newFile.supersedesFileObjectId !== input.oldFileId
    ) {
      throw new BadRequestException("新文件已关联其他被替换文件");
    }

    const visitedFileIds = new Set<string>([oldFile.id]);
    let previousFileId = oldFile.supersedesFileObjectId;
    while (previousFileId) {
      if (previousFileId === input.newFileId || visitedFileIds.has(previousFileId)) {
        throw new BadRequestException("文件替换链存在循环，无法接入");
      }

      let previousFile = lockedFilesById.get(previousFileId);
      if (!previousFile) {
        const lockedPreviousFiles = await tx.$queryRaw<LockedFileReplacementRow[]>(Prisma.sql`
          SELECT "id", "uploadedByUserId", "storageStatus", "supersedesFileObjectId"
          FROM "FileObject"
          WHERE "id" = ${previousFileId}
          FOR UPDATE
        `);
        previousFile = lockedPreviousFiles[0];
        if (!previousFile) {
          throw new BadRequestException("文件替换链状态异常，无法接入");
        }
        lockedFilesById.set(previousFile.id, previousFile);
      }
      if (previousFile.storageStatus !== "active") {
        throw new BadRequestException("文件替换链状态异常，无法接入");
      }
      visitedFileIds.add(previousFile.id);
      previousFileId = previousFile.supersedesFileObjectId;
    }

    if (newFile.supersedesFileObjectId === input.oldFileId) {
      return;
    }

    const updated = await tx.fileObject.updateMany({
      where: {
        id: input.newFileId,
        uploadedByUserId: input.actorUserId,
        storageStatus: "active",
        supersedesFileObjectId: null
      },
      data: { supersedesFileObjectId: input.oldFileId }
    });
    if (updated.count === 1) {
      return;
    }

    const current = await tx.fileObject.findUnique({
      where: { id: input.newFileId },
      select: { supersedesFileObjectId: true }
    });
    if (current?.supersedesFileObjectId === input.oldFileId) {
      return;
    }

    throw new BadRequestException("新文件已关联其他被替换文件");
  }

  async createDownloadTicket(fileId: string, input: CreateFileDownloadTicketInput) {
    if (!input.actorUserId.trim()) {
      throw new Error("下载人信息缺失，请重新登录后再下载资料");
    }
    const downloadReason = normalizeDownloadReason(input.downloadReason);
    const accessMode = input.accessMode ?? "download";

    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.findUnique({
        where: { id: fileId }
      });

      if (!file) {
        throw new Error("资料文件不存在或已被移除");
      }

      if (accessMode === "preview" && file.mimeType !== "application/pdf") {
        throw new BadRequestException("仅 PDF 文件支持在线预览，请下载原文件查看");
      }

      await this.assertCanDownloadFileObject(tx, file, input.actorUserId);

      const expiresAtMs = Date.now() + 5 * 60 * 1000;
      const expiresAt = new Date(expiresAtMs).toISOString();
      const token = this.signDownloadToken(
        file.id,
        input.actorUserId,
        expiresAt,
        downloadReason,
        accessMode
      );
      await this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: accessMode === "preview" ? "file.preview.ticket" : "file.download.ticket",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          expiresAt,
          downloadReason,
          ...(accessMode === "preview" ? { accessMode } : {})
        }
      });

      return {
        fileId: file.id,
        fileName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        expiresAt,
        downloadUrl: `/files/${file.id}/download?actorUserId=${encodeURIComponent(
          input.actorUserId
        )}&expiresAt=${encodeURIComponent(
          expiresAt
        )}&downloadReason=${encodeURIComponent(
          downloadReason
        )}&accessMode=${accessMode}&token=${encodeURIComponent(token)}`
      };
    });
  }

  async readPrivateFile(fileId: string, input: ReadPrivateFileInput) {
    if (!input.actorUserId.trim()) {
      throw new BadRequestException("下载人信息缺失，请重新登录后再下载资料");
    }

    if (Number.isNaN(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) < Date.now()) {
      throw new BadRequestException("下载链接已过期，请重新申请下载");
    }
    const downloadReason = normalizeDownloadReason(input.downloadReason);
    const accessMode = input.accessMode ?? "download";
    const validTicket = this.verifyDownloadToken(
      fileId,
      input.actorUserId,
      input.expiresAt,
      downloadReason,
      accessMode,
      input.token
    );

    if (!validTicket && !(input.accessMode === undefined && this.verifyLegacyDownloadToken(
      fileId,
      input.actorUserId,
      input.expiresAt,
      downloadReason,
      input.token
    ))) {
      throw new BadRequestException("下载链接校验失败，请重新申请下载");
    }

    const file = await this.prisma.$transaction(async (tx) => {
      const found = await tx.fileObject.findUnique({
        where: { id: fileId }
      });

      if (!found) {
        throw new Error("资料文件不存在或已被移除");
      }

      await this.assertCanDownloadFileObject(tx, found, input.actorUserId);
      if (accessMode === "preview" && found.mimeType !== "application/pdf") {
        throw new BadRequestException("仅 PDF 文件支持在线预览，请下载原文件查看");
      }
      return found;
    });

    const buffer = await this.readVerifiedFileBuffer(file);
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: accessMode === "preview" ? "file.preview" : "file.download",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          originalName: file.originalName,
          sizeBytes: file.sizeBytes,
          downloadReason,
          ...(accessMode === "preview" ? { accessMode } : {})
        }
      })
    );

    return {
      file,
      buffer,
      accessMode
    };
  }

  // 内部服务读取，不走用户下载权限与审计。
  async getFileBuffer(fileId: string): Promise<InternalFileBuffer> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new Error("资料文件不存在或已被移除");
    }
    return { file, buffer: await this.readVerifiedFileBuffer(file) };
  }

  async discardUnlinkedGeneratedFile(fileId: string, actorUserId: string): Promise<void> {
    const discarded = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE
      `);
      const file = await tx.fileObject.findUnique({ where: { id: fileId } });
      if (!file || file.uploadedByUserId !== actorUserId || file.storageStatus !== "active") {
        return null;
      }
      if (await this.isFileReferenced(tx, fileId)) return null;
      const updated = await tx.fileObject.updateMany({
        where: { id: fileId, uploadedByUserId: actorUserId, storageStatus: "active" },
        data: { storageStatus: "discarded" }
      });
      if (updated.count !== 1) return null;
      await this.audit.record(tx, {
        actorUserId,
        action: "file.generated_orphan.discard",
        businessType: "file_object",
        businessId: fileId
      });
      return { objectKey: file.objectKey };
    });
    if (!discarded) return;
    try {
      await this.storage.delete(discarded.objectKey);
    } catch (error) {
      this.logger.error({
        event: "discarded_generated_file_storage_cleanup_failed",
        fileId,
        error: safeErrorSummary(error, "orphan_cleanup")
      });
    }
  }

  async discardUnlinkedGeneratedFiles(
    fileIds: string[],
    actorUserId: string
  ): Promise<void> {
    for (const fileId of [...new Set(fileIds)].sort()) {
      try {
        await this.discardUnlinkedGeneratedFile(fileId, actorUserId);
      } catch (error) {
        this.logger.error({
          event: "generated_file_batch_cleanup_failed",
          fileId,
          error: safeErrorSummary(error, "orphan_cleanup")
        });
      }
    }
  }

  private async isFileReferenced(tx: Prisma.TransactionClient, fileId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ referenced: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM "User" WHERE "signatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "HandwrittenSignatureVersion" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractVersion" WHERE "taxFactEvidenceFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractTaxFactRevision" WHERE "evidenceFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractTakeoverCorrection" WHERE "attachmentFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractTakeoverSettlementEvidence" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractTakeoverHistoricalPaymentVoucher" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractTakeoverExcessEvidence" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "Settlement" WHERE "preparerSignatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SettlementSignedDocument" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SettlementSignedDocumentGenerationClaim" WHERE "uploadedFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ApprovalFormGenerationClaim" WHERE "uploadedFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SettlementArchiveFile" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractArchiveFile" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ArchiveRecord" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "PdfDocument" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractFormalFile" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractAuthorization" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SettlementImport" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SettlementTemplateVersion" WHERE "xlsxFileId" = ${fileId} OR "previewXlsxFileId" = ${fileId} OR "previewPdfFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SettlementTemplatePreviewJob" WHERE "previewXlsxFileId" = ${fileId} OR "previewPdfFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectOwnerContract" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "PaymentExecution" WHERE "voucherFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementAttachment" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementPayment" WHERE "supportingAttachmentFileId" = ${fileId} OR "merchantPaymentProofFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementPaymentExecution" WHERE "voucherFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementPaymentAttachment" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementPaymentExecutionVoucher" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementPaymentInvoice" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementPaymentArchive" WHERE "generatedPackageFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementPaymentArchiveFile" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementRefund" WHERE "voucherFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "SpotProcurementReceiptPhoto" WHERE "originalFileId" = ${fileId} OR "watermarkedFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "InvoiceRecord" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "NoInvoiceConfirmation" WHERE "proofFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "InvoiceExceptionConfirmation" WHERE "proofFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectExpenseRequest" WHERE "attachmentFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ExpenseClaimAttachment" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectExpenseExecution" WHERE "voucherFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectReceipt" WHERE "voucherFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectProxyPayment" WHERE "voucherFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectUpstreamSettlement" WHERE "voucherFileId" = ${fileId} OR "confirmationSignatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectUpstreamFundFact" WHERE "evidenceFileId" = ${fileId} OR "confirmationSignatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectAffiliateContractFact" WHERE "evidenceFileId" = ${fileId} OR "confirmationSignatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectAffiliateSettlementFact" WHERE "evidenceFileId" = ${fileId} OR "confirmationSignatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectAffiliatePaymentFact" WHERE "evidenceFileId" = ${fileId} OR "confirmationSignatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectAffiliateBusinessEvidence" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectSettlementExceptionQuota" WHERE "attachmentFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ProjectFinancingQuota" WHERE "attachmentFileId" = ${fileId} OR "terminationSignatureFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ApprovalActionLog" WHERE "signatureFileIdSnapshot" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractLayoutTemplateVersion" WHERE "docxFileId" = ${fileId} OR "previewPdfFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractLayoutPreviewJob" WHERE "previewPdfFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractBill" WHERE "sourceExcelFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractBillImport" WHERE "fileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractGeneratedDocument" WHERE "docxFileId" = ${fileId} OR "pdfFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "ContractOfflineRevision" WHERE "fileId" = ${fileId} OR "previewPdfFileId" = ${fileId}
        UNION ALL SELECT 1 FROM "FileObject" WHERE "id" = ${fileId} AND "supersedesFileObjectId" IS NOT NULL
        UNION ALL SELECT 1 FROM "FileObject" WHERE "supersedesFileObjectId" = ${fileId}
      ) AS "referenced"
    `);
    return rows[0]?.referenced === true;
  }

  async discardSettlementClaimObject(claimToken: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(claimToken)) {
      throw new BadRequestException("结算签名合成任务令牌无效");
    }
    await this.storage.delete(`uploads/settlement-signed-generation/${claimToken}.pdf`);
  }

  // 收货照片转换专用：只读取指定上传人的、具备完整性元数据的活动文件。
  async getOwnedVerifiedFileBuffer(
    fileId: string,
    expectedUploadedByUserId: string
  ): Promise<InternalFileBuffer> {
    if (!expectedUploadedByUserId.trim()) {
      throw new ForbiddenException("当前账号无权使用该收货原始文件");
    }
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new Error("资料文件不存在或已被移除");
    }
    if (file.uploadedByUserId !== expectedUploadedByUserId) {
      throw new ForbiddenException("当前账号无权使用该收货原始文件");
    }
    if (file.storageStatus !== "active") {
      throw new Error("资料文件当前不可用，请联系管理员核对文件状态");
    }
    if (!file.contentSha256 || !/^[0-9a-f]{64}$/.test(file.contentSha256)) {
      this.logger.error(`私有文件完整性元数据无效 fileId=${file.id}`);
      throw new Error("资料文件完整性校验失败，请联系管理员核对存储文件");
    }

    const buffer = await this.readVerifiedFileBuffer(file);
    if (
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes < 0 ||
      buffer.length !== file.sizeBytes
    ) {
      this.logger.error(`私有文件大小校验失败 fileId=${file.id}`);
      throw new Error("资料文件完整性校验失败，请联系管理员核对存储文件");
    }
    return { file, buffer };
  }

  // 水印生成后的失败补偿：已绑定收货照片的文件必须保留，不能被模糊失败误隔离。
  async quarantineUnboundReceiptWatermark(
    fileId: string,
    actorUserId: string
  ): Promise<boolean> {
    if (!fileId.trim() || !actorUserId.trim()) return false;

    return this.prisma.$transaction(async (tx) => {
      await acquireFileBusinessBindingTransactionLock(tx);
      const rows = await tx.$queryRaw<LockedGeneratedFileRow[]>(Prisma.sql`
        SELECT "id", "uploadedByUserId", "storageStatus"
        FROM "FileObject"
        WHERE "id" = ${fileId}
        FOR UPDATE
      `);
      const file = rows[0];
      if (
        !file ||
        file.uploadedByUserId !== actorUserId ||
        file.storageStatus !== "active"
      ) {
        return false;
      }

      const binding = await tx.spotProcurementReceiptPhoto.findFirst({
        where: {
          OR: [
            { originalFileId: fileId },
            { watermarkedFileId: fileId }
          ]
        },
        select: { id: true }
      });
      if (
        binding ||
        (await hasNonReceiptBusinessFileBinding(tx, [fileId]))
      ) {
        return false;
      }

      const updated = await tx.fileObject.updateMany({
        where: {
          id: fileId,
          uploadedByUserId: actorUserId,
          storageStatus: "active"
        },
        data: { storageStatus: "quarantined" }
      });
      if (updated.count !== 1) return false;

      await this.audit.record(tx, {
        actorUserId,
        action: "file.quarantine.unbound_receipt_watermark",
        businessType: "file_object",
        businessId: fileId,
        metadata: { reason: "receipt_watermark_binding_failed" }
      });
      return true;
    });
  }

  // 业务绑定前必须在同一事务内调用：文件行锁使“检查+写入绑定”串行化。
  async assertFileHasNoBusinessBinding(
    tx: Prisma.TransactionClient,
    fileId: string
  ): Promise<LockedUnboundFileRow> {
    const normalizedFileId = fileId.trim();
    if (!normalizedFileId) {
      throw new BadRequestException("请选择需要绑定的文件");
    }

    await acquireFileBusinessBindingTransactionLock(tx);
    const rows = await tx.$queryRaw<LockedUnboundFileRow[]>(Prisma.sql`
      SELECT "id", "uploadedByUserId", "storageStatus"
      FROM "FileObject"
      WHERE "id" = ${normalizedFileId}
      FOR UPDATE
    `);
    const file = rows[0];
    if (!file) {
      throw new BadRequestException("文件不存在或已被移除");
    }
    if (file.storageStatus !== "active") {
      throw new BadRequestException("文件当前不可用");
    }

    const [receiptPhotoBinding, hasOtherBinding] = await Promise.all([
      tx.spotProcurementReceiptPhoto.findFirst({
        where: {
          OR: [
            { originalFileId: normalizedFileId },
            { watermarkedFileId: normalizedFileId }
          ]
        },
        select: { id: true }
      }),
      hasNonReceiptBusinessFileBinding(tx, [normalizedFileId])
    ]);
    if (receiptPhotoBinding || hasOtherBinding) {
      throw new ConflictException(FILE_ALREADY_BOUND_MESSAGE);
    }

    return file;
  }

  async assertCanBindContractDraftAttachments(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    fileIds: string[],
    actorUserId: string
  ) {
    const normalizedIds = [...new Set(fileIds.map((fileId) => fileId.trim()))].sort();
    if (normalizedIds.some((fileId) => !fileId)) {
      throw new BadRequestException("合同草稿附件文件编号不能为空");
    }
    if (!normalizedIds.length) return;
    await acquireFileBusinessBindingTransactionLock(tx);
    const files = await tx.$queryRaw<LockedUnboundFileRow[]>(Prisma.sql`
      SELECT "id", "mimeType", "uploadedByUserId", "storageStatus"
      FROM "FileObject"
      WHERE "id" IN (${Prisma.join(normalizedIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    if (files.length !== normalizedIds.length) {
      throw new BadRequestException("合同草稿附件不存在或已被移除");
    }
    if (files.some((file) => file.storageStatus !== "active")) {
      throw new BadRequestException("合同草稿附件当前不可用");
    }
    if (files.some((file) => file.uploadedByUserId !== actorUserId)) {
      throw new ForbiddenException("合同草稿附件必须由当前经办人本人上传");
    }
    const [otherDraftBinding, receiptPhotoBinding, otherBindingIds] = await Promise.all([
      tx.contractDraftAttachment.findFirst({
        where: {
          fileId: { in: normalizedIds },
          contractVersionId: { not: contractVersionId }
        },
        select: { id: true }
      }),
      tx.spotProcurementReceiptPhoto.findFirst({
        where: {
          OR: [
            { originalFileId: { in: normalizedIds } },
            { watermarkedFileId: { in: normalizedIds } }
          ]
        },
        select: { id: true }
      }),
      nonReceiptBusinessFileBindingIds(tx, normalizedIds, [
        { table: "ContractDraftAttachment", column: "fileId" }
      ])
    ]);
    if (otherDraftBinding || receiptPhotoBinding || otherBindingIds.length) {
      throw new ConflictException(FILE_ALREADY_BOUND_MESSAGE);
    }
  }

  // 供其它模块（如审批单下载）按 fileId 复用下载权限校验。
  async assertCanDownloadFileById(fileId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertCanDownloadFile(tx, fileId, actorUserId);
    });
  }

  async assertCanDownloadContractApprovalForm(
    contractVersionId: string,
    actorUserId: string
  ) {
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId },
        select: { id: true, contractId: true }
      });
      const contract = version ? await tx.contract.findUnique({
        where: { id: version.contractId },
        select: { projectId: true, ownerUserId: true, voidedAt: true }
      }) : null;
      if (!version || !contract || contract.voidedAt) {
        throw new ForbiddenException("当前账号无权下载该合同审批单");
      }
      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          status: "approved"
        },
        orderBy: { updatedAt: "desc" }
      });
      if (!instance) throw new BadRequestException("当前合同尚未完成审批，暂不能下载审批单");
      if (contract.ownerUserId === actorUserId || instance.applicantUserId === actorUserId) return;
      if (await tx.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id, actorUserId, action: "approve" },
        select: { id: true }
      })) return;
      const roles = await this.loadActorRoleKeys(tx, actorUserId, contract.projectId);
      const exactReaders = new Set<RoleKey>([
        "contract_staff", "contract_director", "project_manager", "finance_staff",
        "finance_director", "comprehensive_director", "chairman", "general_manager"
      ]);
      if (roles.some((role) => exactReaders.has(role))) return;
      throw new ForbiddenException("当前账号无权下载该合同审批单");
    });
  }

  async assertCanDownloadApprovalFormByBusiness(
    businessType: string,
    businessId: string,
    actorUserId: string
  ) {
    if (businessType === "contract_version") {
      return this.assertCanDownloadContractApprovalForm(businessId, actorUserId);
    }
    if (
      businessType !== "settlement" &&
      businessType !== "payment_request" &&
      businessType !== "expense_claim"
    ) {
      throw new BadRequestException("当前业务类型不支持下载审批单");
    }

    await this.prisma.$transaction(async (tx) => {
      const instance = await tx.approvalInstance.findFirst({
        where: { businessType, businessId, status: "approved" },
        orderBy: { updatedAt: "desc" }
      });
      if (!instance) {
        throw new BadRequestException("当前业务尚未完成审批，暂不能下载审批单");
      }
      if (instance.applicantUserId === actorUserId) return;

      const participated = await tx.approvalActionLog.findFirst({
        where: {
          approvalInstanceId: instance.id,
          actorUserId,
          action: { in: ["approve", "reject_previous", "return_to_applicant"] }
        }
      });
      if (participated) return;

      const projectId = await this.resolveApprovalProjectId(tx, businessType, businessId);
      if (
        projectId &&
        (await this.hasProjectRole(
          tx,
          actorUserId,
          projectId,
          ARCHIVE_FILE_DOWNLOAD_ROLES
        ))
      ) {
        return;
      }

      throw new ForbiddenException("当前账号无权下载该审批单");
    });
  }

  async assertCanDownloadFile(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ) {
    const file = await tx.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new BadRequestException("资料文件不存在或已被移除");
    }
    await this.assertCanDownloadFileObject(tx, file, actorUserId);
    return file;
  }

  async assertCanAttachUnlinkedFile(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE
    `);
    const file = await tx.fileObject.findUnique({
      where: { id: fileId },
      select: { id: true, uploadedByUserId: true, storageStatus: true }
    });
    if (!file || file.storageStatus !== "active") {
      throw new BadRequestException("更正依据附件不存在或当前不可用，请重新上传");
    }
    if (file.uploadedByUserId !== actorUserId) {
      throw new ForbiddenException("更正依据附件必须由当前合同员本人上传");
    }
    if (await this.isFileReferenced(tx, fileId)) {
      throw new BadRequestException("该文件已用于其他业务，请重新上传专用的更正依据附件");
    }
    return file;
  }

  async assertCanUseHistoricalTakeoverFile(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string,
    allowCurrentTakeoverBinding: boolean
  ) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE
    `);
    const file = await tx.fileObject.findUnique({
      where: { id: fileId },
      select: { id: true, uploadedByUserId: true, storageStatus: true }
    });
    if (!file || file.storageStatus !== "active") {
      throw new BadRequestException("历史接管资料不存在或当前不可用，请重新上传");
    }
    if (file.uploadedByUserId !== actorUserId) {
      throw new ForbiddenException("历史接管资料必须由当前办理人本人上传");
    }
    if (
      !allowCurrentTakeoverBinding &&
      await this.isFileReferenced(tx, fileId)
    ) {
      throw new BadRequestException("该文件已绑定其他业务记录，不能用于历史接管");
    }
    return file;
  }

  private safeFileName(fileName: string) {
    const name = basename(fileName).replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_");
    return name || "private-file";
  }

  private async readVerifiedFileBuffer(file: FileObject): Promise<Buffer> {
    if (file.storageStatus !== "active") {
      throw new Error("资料文件当前不可用，请联系管理员核对文件状态");
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.read(file.objectKey);
    } catch {
      throw new Error("资料文件暂时无法读取，请稍后重试或联系管理员核对私有存储");
    }

    if (file.contentSha256 === null) {
      return buffer;
    }

    const actualContentSha256 = createHash("sha256").update(buffer).digest("hex");
    if (
      !/^[0-9a-f]{64}$/.test(file.contentSha256) ||
      actualContentSha256 !== file.contentSha256
    ) {
      this.logger.error(`私有文件完整性校验失败 fileId=${file.id}`);
      throw new Error("资料文件完整性校验失败，请联系管理员核对存储文件");
    }

    return buffer;
  }

  private async assertCanDownloadFileObject(
    tx: Prisma.TransactionClient,
    file: FileObject,
    actorUserId: string
  ) {
    const governedSettlementAccess = await this.governedSettlementSignedDocumentAccess(
      tx,
      file.id,
      actorUserId
    );
    if (governedSettlementAccess === false) {
      throw new ForbiddenException("当前账号无权下载该结算签章资料");
    }
    const governedContractAccess = await this.governedContractFileAccess(
      tx,
      file.id,
      actorUserId
    );
    if (governedContractAccess === false) {
      throw new ForbiddenException("当前账号无权下载该合同签署资料");
    }
    if (governedSettlementAccess || governedContractAccess) {
      const governedSpotDecision = await this.spotAccess.resolveFileDownloadAccess(
        file.id,
        actorUserId,
        tx
      );
      if (governedSpotDecision !== "not_spot") {
        throw new Error("资料文件存在跨业务绑定冲突，暂不能下载");
      }
      return;
    }
    const takeoverCorrectionClient = (tx as unknown as {
      contractTakeoverCorrection?: {
        findFirst(args: {
          where: { attachmentFileId: string };
          select: { projectId: true };
        }): Promise<{ projectId: string } | null>;
      };
    }).contractTakeoverCorrection;
    const takeoverCorrection = takeoverCorrectionClient
      ? await takeoverCorrectionClient.findFirst({
          where: { attachmentFileId: file.id },
          select: { projectId: true }
        })
      : null;
    const spotDecision = await this.spotAccess.resolveFileDownloadAccess(
      file.id,
      actorUserId,
      tx
    );
    if (spotDecision === "allowed") {
      const [
        receiptBinding,
        refundBindings,
        spotPaymentInvoiceBindings,
        invoiceRecordBindings,
        noInvoiceBindings,
        invoiceExceptionBindings
      ] = await Promise.all([
        tx.spotProcurementReceiptPhoto.findFirst({
          where: {
            OR: [
              { originalFileId: file.id },
              { watermarkedFileId: file.id }
            ]
          },
          select: { id: true }
        }),
        tx.spotProcurementRefund.findMany({
          where: { voucherFileId: file.id },
          select: { id: true },
          take: 2
        }),
        tx.spotProcurementPaymentInvoice.findMany({
          where: { fileId: file.id },
          select: { id: true },
          take: 2
        }),
        tx.invoiceRecord.findMany({
          where: { fileId: file.id },
          select: { id: true },
          take: 2
        }),
        tx.noInvoiceConfirmation.findMany({
          where: { proofFileId: file.id },
          select: { id: true },
          take: 2
        }),
        tx.invoiceExceptionConfirmation.findMany({
          where: { proofFileId: file.id },
          select: { id: true },
          take: 2
        })
      ]);
      const evidenceBindingExclusions = [
        ...spotPaymentInvoiceBindings.map(
          () => SPOT_PAYMENT_INVOICE_FILE_BINDING
        ),
        ...invoiceRecordBindings.map(() => INVOICE_RECORD_FILE_BINDING),
        ...noInvoiceBindings.map(() => NO_INVOICE_PROOF_BINDING),
        ...invoiceExceptionBindings.map(
          () => INVOICE_EXCEPTION_PROOF_BINDING
        )
      ];
      if (
        takeoverCorrection !== null
      ) {
        throw new Error("资料文件存在跨业务绑定冲突，暂不能下载");
      }
      if (
        evidenceBindingExclusions.length > 1 ||
        (evidenceBindingExclusions.length === 1 &&
          (receiptBinding ||
            refundBindings.length > 0 ||
            (await hasNonReceiptBusinessFileBinding(
              tx,
              [file.id],
              evidenceBindingExclusions[0]
            ))))
      ) {
        throw new Error("资料文件存在跨业务绑定冲突，暂不能下载");
      }
      if (evidenceBindingExclusions.length === 1) {
        return;
      }
      if (
        receiptBinding &&
        (await hasNonReceiptBusinessFileBinding(tx, [file.id]))
      ) {
        throw new Error("资料文件存在跨业务绑定冲突，暂不能下载");
      }
      if (
        refundBindings.length > 1 ||
        (refundBindings.length === 1 &&
          (receiptBinding ||
            (await hasNonReceiptBusinessFileBinding(
              tx,
              [file.id],
              REFUND_VOUCHER_BINDING
            ))))
      ) {
        throw new Error("资料文件存在跨业务绑定冲突，暂不能下载");
      }
      return;
    }
    if (spotDecision === "denied") {
      throw new Error("当前账号无权下载该零星采购资料");
    }

    if (takeoverCorrection) {
      if (
        await this.hasProjectRole(
          tx,
          actorUserId,
          takeoverCorrection.projectId,
          HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS
        )
      ) {
        return;
      }
      throw new ForbiddenException("当前账号无权下载该历史接管更正依据");
    }
    const projectOwnerContractClient = (tx as unknown as {
      projectOwnerContract?: {
        findFirst: (args: {
          where: { fileId: string; voidedAt?: null | { not: null } };
          select: { id?: true; projectId?: true };
        }) => Promise<{ id?: string; projectId?: string } | null>;
      };
    }).projectOwnerContract;
    const projectOwnerContract = projectOwnerContractClient
      ? await projectOwnerContractClient.findFirst({
          where: { fileId: file.id, voidedAt: null },
          select: { projectId: true }
        })
      : null;

    if (
      projectOwnerContract?.projectId &&
      (await this.hasProjectRole(
        tx,
        actorUserId,
        projectOwnerContract.projectId,
        ARCHIVE_FILE_DOWNLOAD_ROLES
      ))
    ) {
      return;
    }

    const voidedProjectOwnerContract = projectOwnerContractClient
      ? await projectOwnerContractClient.findFirst({
          where: { fileId: file.id, voidedAt: { not: null } },
          select: { id: true }
        })
      : null;

    if (voidedProjectOwnerContract) {
      throw new ForbiddenException("当前账号无权下载该资料");
    }

    const settlementTemplateVersionClient = (tx as unknown as {
      settlementTemplateVersion?: {
        findFirst(args: { where: { OR: Array<Record<string, string>> }; select: { id: true } }): Promise<{ id: string } | null>;
      };
    }).settlementTemplateVersion;
    const settlementTemplateVersion = settlementTemplateVersionClient
      ? await settlementTemplateVersionClient.findFirst({
          where: {
            OR: [
              { xlsxFileId: file.id },
              { previewXlsxFileId: file.id },
              { previewPdfFileId: file.id }
            ]
          },
          select: { id: true }
        })
      : null;
    const settlementTemplatePreviewClient = (tx as unknown as {
      settlementTemplatePreviewJob?: {
        findFirst(args: { where: { OR: Array<Record<string, string>> }; select: { id: true } }): Promise<{ id: string } | null>;
      };
    }).settlementTemplatePreviewJob;
    const settlementTemplatePreview = settlementTemplateVersion || !settlementTemplatePreviewClient
      ? null
      : await settlementTemplatePreviewClient.findFirst({
          where: {
            OR: [{ previewXlsxFileId: file.id }, { previewPdfFileId: file.id }]
          },
          select: { id: true }
        });
    if (settlementTemplateVersion || settlementTemplatePreview) {
      if (
        await this.hasGlobalRole(tx, actorUserId, ["contract_director", "super_admin"])
      ) {
        return;
      }
      throw new ForbiddenException("当前账号无权下载该结算模板文件");
    }

    const offlineRevisionClient = (tx as unknown as {
      contractOfflineRevision?: {
        findFirst(args: {
          where: {
            OR: Array<{ fileId: string } | { previewPdfFileId: string }>;
          };
          select: { contractVersionId: true };
        }): Promise<{ contractVersionId: string } | null>;
      };
    }).contractOfflineRevision;
    const offlineRevisionPreview = offlineRevisionClient
      ? await offlineRevisionClient.findFirst({
          where: {
            OR: [{ fileId: file.id }, { previewPdfFileId: file.id }]
          },
          select: { contractVersionId: true }
        })
      : null;
    if (offlineRevisionPreview) {
      const version = await tx.contractVersion.findUnique({
        where: { id: offlineRevisionPreview.contractVersionId },
        select: { contractId: true }
      });
      const contract = version
        ? await tx.contract.findUnique({
            where: { id: version.contractId },
            select: { ownerUserId: true, voidedAt: true }
          })
        : null;
      if (contract?.ownerUserId === actorUserId && !contract.voidedAt) return;
      throw new ForbiddenException("当前账号无权下载该线下修订稿文件");
    }

    const expenseAttachmentAccess = await this.resolveExpenseClaimAttachmentAccess(
      tx,
      file.id,
      actorUserId
    );
    if (expenseAttachmentAccess === true) return;
    if (expenseAttachmentAccess === false) {
      throw new ForbiddenException("当前账号无权下载该费用附件");
    }

    const affiliateBusinessClients = tx as unknown as {
      projectAffiliateContractFact?: {
        findFirst(args: unknown): Promise<{ projectId: string } | null>;
      };
      projectAffiliateSettlementFact?: {
        findFirst(args: unknown): Promise<{ projectId: string } | null>;
      };
      projectAffiliatePaymentFact?: {
        findFirst(args: unknown): Promise<{ projectId: string } | null>;
      };
      projectAffiliateBusinessEvidence?: {
        findFirst(
          args: unknown
        ): Promise<{ projectId: string; businessType: string } | null>;
      };
      projectAffiliateCompanyContract?: {
        findFirst(args: unknown): Promise<{ projectId: string } | null>;
      };
    };
    const [
      affiliateContractFact,
      affiliateSettlementFact,
      affiliatePaymentFact,
      affiliateSupplementalEvidence,
      affiliateCompanyContract
    ] = await Promise.all([
      affiliateBusinessClients.projectAffiliateContractFact?.findFirst({
        where: {
          OR: [
            { evidenceFileId: file.id },
            { confirmationSignatureFileId: file.id }
          ]
        },
        select: { projectId: true }
      }) ?? null,
      affiliateBusinessClients.projectAffiliateSettlementFact?.findFirst({
        where: {
          OR: [
            { evidenceFileId: file.id },
            { confirmationSignatureFileId: file.id }
          ]
        },
        select: { projectId: true }
      }) ?? null,
      affiliateBusinessClients.projectAffiliatePaymentFact?.findFirst({
        where: {
          OR: [
            { evidenceFileId: file.id },
            { confirmationSignatureFileId: file.id }
          ]
        },
        select: { projectId: true }
      }) ?? null,
      affiliateBusinessClients.projectAffiliateBusinessEvidence?.findFirst({
        where: { fileId: file.id },
        select: { projectId: true, businessType: true }
      }) ?? null,
      affiliateBusinessClients.projectAffiliateCompanyContract?.findFirst({
        where: {
          OR: [{ fileId: file.id }, { confirmationSignatureFileId: file.id }]
        },
        select: { projectId: true }
      }) ?? null
    ]);
    const affiliateFileAccess = affiliateCompanyContract
      ? {
          projectId: affiliateCompanyContract.projectId,
          roles: AFFILIATE_CONTRACT_FILE_DOWNLOAD_ROLES
        }
      : affiliateContractFact
      ? {
          projectId: affiliateContractFact.projectId,
          roles: AFFILIATE_CONTRACT_FILE_DOWNLOAD_ROLES
        }
      : affiliateSettlementFact
        ? {
            projectId: affiliateSettlementFact.projectId,
            roles: AFFILIATE_SETTLEMENT_FILE_DOWNLOAD_ROLES
          }
        : affiliatePaymentFact
          ? {
              projectId: affiliatePaymentFact.projectId,
              roles: PAYMENT_FILE_DOWNLOAD_ROLES
            }
          : affiliateSupplementalEvidence
            ? {
                projectId: affiliateSupplementalEvidence.projectId,
                roles:
                  affiliateSupplementalEvidence.businessType === "contract"
                    ? AFFILIATE_CONTRACT_FILE_DOWNLOAD_ROLES
                    : affiliateSupplementalEvidence.businessType === "settlement"
                      ? AFFILIATE_SETTLEMENT_FILE_DOWNLOAD_ROLES
                      : PAYMENT_FILE_DOWNLOAD_ROLES
              }
            : null;
    if (affiliateFileAccess) {
      if (
        await this.hasProjectRole(
          tx,
          actorUserId,
          affiliateFileAccess.projectId,
          affiliateFileAccess.roles
        )
      ) {
        return;
      }
      throw new ForbiddenException("当前账号无权下载该挂靠外部业务资料");
    }

    if (file.uploadedByUserId === actorUserId && !projectOwnerContract) {
      return;
    }

    const contractArchiveFile = await tx.contractArchiveFile.findFirst({
      where: { fileId: file.id }
    });
    if (contractArchiveFile) {
      if (contractArchiveFile.status !== "confirmed") {
        throw new BadRequestException("资料尚未归档确认，暂不能下载");
      }
      const version = await tx.contractVersion.findUnique({
        where: { id: contractArchiveFile.contractVersionId }
      });
      const contract = version
        ? await tx.contract.findUnique({ where: { id: version.contractId } })
        : null;

      if (
        contract &&
        (await this.hasProjectRole(tx, actorUserId, contract.projectId, ARCHIVE_FILE_DOWNLOAD_ROLES))
      ) {
        return;
      }
    }

    const settlementArchiveFile = await tx.settlementArchiveFile.findFirst({
      where: { fileId: file.id }
    });
    if (settlementArchiveFile) {
      if (settlementArchiveFile.status !== "confirmed") {
        throw new BadRequestException("资料尚未归档确认，暂不能下载");
      }
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementArchiveFile.settlementId }
      });

      if (
        settlement &&
        (await this.hasProjectRole(
          tx,
          actorUserId,
          settlement.projectId,
          ARCHIVE_FILE_DOWNLOAD_ROLES
        ))
      ) {
        return;
      }
    }

    const paymentExecution = await tx.paymentExecution.findFirst({
      where: { voucherFileId: file.id }
    });
    if (paymentExecution) {
      const payment = await tx.paymentRequest.findUnique({
        where: { id: paymentExecution.paymentRequestId }
      });

      if (
        payment &&
        (await this.hasProjectRole(tx, actorUserId, payment.projectId, PAYMENT_FILE_DOWNLOAD_ROLES))
      ) {
        return;
      }
    }

    const projectExpenseExecutionClient = (tx as unknown as {
      projectExpenseExecution?: {
        findFirst: (args: {
          where: { voucherFileId: string };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectExpenseExecution;
    const projectExpenseExecution = projectExpenseExecutionClient
      ? await projectExpenseExecutionClient.findFirst({
          where: { voucherFileId: file.id },
          select: { projectId: true }
        })
      : null;
    if (
      projectExpenseExecution &&
      (await this.hasProjectRole(
        tx,
        actorUserId,
        projectExpenseExecution.projectId,
        PAYMENT_FILE_DOWNLOAD_ROLES
      ))
    ) {
      return;
    }

    const projectReceiptClient = (tx as unknown as {
      projectReceipt?: {
        findFirst: (args: {
          where: { voucherFileId: string };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectReceipt;
    const projectReceipt = projectReceiptClient
      ? await projectReceiptClient.findFirst({
          where: { voucherFileId: file.id },
          select: { projectId: true }
        })
      : null;
    if (
      projectReceipt &&
      (await this.hasProjectRole(tx, actorUserId, projectReceipt.projectId, PAYMENT_FILE_DOWNLOAD_ROLES))
    ) {
      return;
    }

    const projectProxyPaymentClient = (tx as unknown as {
      projectProxyPayment?: {
        findFirst: (args: {
          where: { voucherFileId: string; voidedAt: null };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectProxyPayment;
    const projectProxyPayment = projectProxyPaymentClient
      ? await projectProxyPaymentClient.findFirst({
          where: { voucherFileId: file.id, voidedAt: null },
          select: { projectId: true }
        })
      : null;
    if (
      projectProxyPayment &&
      (await this.hasProjectRole(tx, actorUserId, projectProxyPayment.projectId, PAYMENT_FILE_DOWNLOAD_ROLES))
    ) {
      return;
    }

    const projectUpstreamSettlementClient = (tx as unknown as {
      projectUpstreamSettlement?: {
        findFirst: (args: {
          where: {
            OR: Array<
              | { voucherFileId: string }
              | { confirmationSignatureFileId: string }
            >;
            voidedAt: null;
          };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectUpstreamSettlement;
    const projectUpstreamSettlement = projectUpstreamSettlementClient
      ? await projectUpstreamSettlementClient.findFirst({
          where: {
            OR: [
              { voucherFileId: file.id },
              { confirmationSignatureFileId: file.id }
            ],
            voidedAt: null
          },
          select: { projectId: true }
        })
      : null;
    if (
      projectUpstreamSettlement &&
      (await this.hasProjectRole(
        tx,
        actorUserId,
        projectUpstreamSettlement.projectId,
        UPSTREAM_SETTLEMENT_FILE_DOWNLOAD_ROLES
      ))
    ) {
      return;
    }

    const projectUpstreamFundFactClient = (tx as unknown as {
      projectUpstreamFundFact?: {
        findFirst: (args: {
          where: {
            OR: Array<
              | { evidenceFileId: string }
              | { confirmationSignatureFileId: string }
            >;
          };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectUpstreamFundFact;
    const projectUpstreamFundFact = projectUpstreamFundFactClient
      ? await projectUpstreamFundFactClient.findFirst({
          where: {
            OR: [
              { evidenceFileId: file.id },
              { confirmationSignatureFileId: file.id }
            ]
          },
          select: { projectId: true }
        })
      : null;
    if (projectUpstreamFundFact) {
      if (
        await this.hasProjectRole(
          tx,
          actorUserId,
          projectUpstreamFundFact.projectId,
          PAYMENT_FILE_DOWNLOAD_ROLES
        )
      ) {
        return;
      }
      throw new ForbiddenException("当前账号无权下载该上游资金资料");
    }

    const projectSettlementExceptionQuotaClient = (tx as unknown as {
      projectSettlementExceptionQuota?: {
        findFirst: (args: {
          where: { attachmentFileId: string };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectSettlementExceptionQuota;
    const projectSettlementExceptionQuota = projectSettlementExceptionQuotaClient
      ? await projectSettlementExceptionQuotaClient.findFirst({
          where: { attachmentFileId: file.id },
          select: { projectId: true }
        })
      : null;
    if (
      projectSettlementExceptionQuota &&
      (await this.hasProjectRole(
        tx,
        actorUserId,
        projectSettlementExceptionQuota.projectId,
        SETTLEMENT_EXCEPTION_QUOTA_FILE_DOWNLOAD_ROLES
      ))
    ) {
      return;
    }

    const projectFinancingQuotaClient = (tx as unknown as {
      projectFinancingQuota?: {
        findFirst: (args: {
          where: { attachmentFileId: string };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectFinancingQuota;
    const projectFinancingQuota = projectFinancingQuotaClient
      ? await projectFinancingQuotaClient.findFirst({
          where: { attachmentFileId: file.id },
          select: { projectId: true }
        })
      : null;
    if (
      projectFinancingQuota &&
      (await this.hasProjectRole(
        tx,
        actorUserId,
        projectFinancingQuota.projectId,
        PROJECT_FINANCING_QUOTA_FILE_DOWNLOAD_ROLES
      ))
    ) {
      return;
    }

    const projectExpenseRequestClient = (tx as unknown as {
      projectExpenseRequest?: {
        findFirst: (args: {
          where: { attachmentFileId: string; voidedAt: null };
          select: { projectId: true; applicantUserId: true };
        }) => Promise<{ projectId: string; applicantUserId: string } | null>;
      };
    }).projectExpenseRequest;
    const projectExpenseRequest = projectExpenseRequestClient
      ? await projectExpenseRequestClient.findFirst({
          where: { attachmentFileId: file.id, voidedAt: null },
          select: { projectId: true, applicantUserId: true }
        })
      : null;
    if (
      projectExpenseRequest &&
      (projectExpenseRequest.applicantUserId === actorUserId ||
        (await this.hasProjectRole(
          tx,
          actorUserId,
          projectExpenseRequest.projectId,
          PROJECT_EXPENSE_FILE_DOWNLOAD_ROLES
        )))
    ) {
      return;
    }

    // 审批 PDF：申请人、任一签批人，或该项目的归档可读岗位均可下载；
    // 结算审批中的 latest PDF 还允许审批链相关岗位读取，供后续审批人审阅。
    const approvalForm = await tx.pdfDocument.findFirst({
      where: {
        fileId: file.id,
        templateKey: {
          in: [
            "approval_form",
            SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY,
            "settlement_approval_latest"
          ]
        }
      }
    });
    if (approvalForm) {
      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: approvalForm.businessType,
          businessId: approvalForm.businessId,
          status:
            [
              "approval_form",
              SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY
            ].includes(approvalForm.templateKey)
              ? "approved"
              : { in: ["in_progress", "approved"] }
        },
        orderBy: { updatedAt: "desc" }
      });

      if (instance) {
        if (instance.applicantUserId === actorUserId) {
          return;
        }

        const signed = await tx.approvalActionLog.findFirst({
          where: {
            approvalInstanceId: instance.id,
            actorUserId,
            action: { in: ["approve", "reject_previous", "return_to_applicant"] }
          }
        });
        if (signed) {
          return;
        }
      }

      const projectId = await this.resolveApprovalProjectId(
        tx,
        approvalForm.businessType,
        approvalForm.businessId
      );
      if (
        projectId &&
        (await this.hasProjectRole(tx, actorUserId, projectId, ARCHIVE_FILE_DOWNLOAD_ROLES))
      ) {
        return;
      }
      if (
        projectId &&
        approvalForm.templateKey === "settlement_approval_latest" &&
        instance &&
        (await this.hasProjectRole(
          tx,
          actorUserId,
          projectId,
          roleKeysFromApprovalFrozenNodes(instance.frozenNodes)
        ))
      ) {
        return;
      }
    }

    const archiveRecordClient = (tx as unknown as {
      archiveRecord?: {
        findFirst: (args: {
          where: { fileId: string };
          select: { businessType: true; businessId: true };
        }) => Promise<{ businessType: string; businessId: string } | null>;
      };
    }).archiveRecord;
    const archiveRecord = archiveRecordClient
      ? await archiveRecordClient.findFirst({
          where: { fileId: file.id },
          select: { businessType: true, businessId: true }
        })
      : null;
    if (archiveRecord) {
      const projectId = await this.resolveApprovalProjectId(
        tx,
        archiveRecord.businessType,
        archiveRecord.businessId
      );
      if (
        projectId &&
        (await this.hasProjectRole(tx, actorUserId, projectId, ARCHIVE_FILE_DOWNLOAD_ROLES))
      ) {
        return;
      }
    }

    throw new ForbiddenException("当前账号无权下载该资料");
  }

  private async resolveExpenseClaimAttachmentAccess(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ): Promise<boolean | null> {
    const attachmentClient = (tx as unknown as {
      expenseClaimAttachment?: {
        findFirst: (args: {
          where: { fileId: string };
          select: { expenseClaimId: true; attachedByUserId: true; removedAt: true };
        }) => Promise<{ expenseClaimId: string; attachedByUserId: string; removedAt: Date | null } | null>;
      };
    }).expenseClaimAttachment;
    if (!attachmentClient) return null;
    const attachment = await attachmentClient.findFirst({
      where: { fileId },
      select: { expenseClaimId: true, attachedByUserId: true, removedAt: true }
    });
    if (!attachment || attachment.removedAt) return attachment ? false : null;
    const claimClient = (tx as unknown as {
      expenseClaim?: {
        findUnique: (args: {
          where: { id: string };
          select: {
            projectId: true;
            applicantUserId: true;
            handledByUserId: true;
            approvalInstanceId: true;
          };
        }) => Promise<{
          projectId: string | null;
          applicantUserId: string | null;
          handledByUserId: string;
          approvalInstanceId: string | null;
        } | null>;
      };
    }).expenseClaim;
    const claim = claimClient
      ? await claimClient.findUnique({
          where: { id: attachment.expenseClaimId },
          select: {
            projectId: true,
            applicantUserId: true,
            handledByUserId: true,
            approvalInstanceId: true
          }
        })
      : null;
    if (!claim) return false;
    if (
      claim.applicantUserId === actorUserId ||
      claim.handledByUserId === actorUserId ||
      attachment.attachedByUserId === actorUserId
    ) {
      return true;
    }
    const participated = claim.approvalInstanceId
      ? await tx.approvalActionLog.findFirst({
          where: {
            approvalInstanceId: claim.approvalInstanceId,
            actorUserId,
            action: { in: ["approve", "reject_previous", "return_to_applicant"] }
          },
          select: { id: true }
        })
      : null;
    if (participated) return true;
    const readerRoles: readonly RoleKey[] = [
      "comprehensive_director",
      "finance_staff",
      "finance_director",
      "chairman",
      "general_manager"
    ];
    const roles = claim.projectId
      ? await this.loadActorRoleKeys(tx, actorUserId, claim.projectId)
      : await this.loadActorRoleKeys(tx, actorUserId, "__company_scope__");
    return roles.some((role) => readerRoles.includes(role));
  }

  private async governedSettlementSignedDocumentAccess(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ): Promise<boolean | null> {
    const client = (tx as unknown as {
      settlementSignedDocument?: {
        findFirst(args: { where: { fileId: string } }): Promise<{
          status: string;
          purpose: string;
          settlementId: string | null;
          settlementDraftId: string | null;
        } | null>;
      };
    }).settlementSignedDocument;
    const claimClient = (tx as unknown as {
      settlementSignedDocumentGenerationClaim?: {
        findFirst(args: { where: { uploadedFileId: string } }): Promise<{ status: string } | null>;
      };
    }).settlementSignedDocumentGenerationClaim;
    const claim = claimClient
      ? await claimClient.findFirst({ where: { uploadedFileId: fileId } })
      : null;
    if (claim && claim.status !== "completed") return false;
    if (!client) return claim ? false : null;
    const document = await client.findFirst({ where: { fileId } });
    if (!document) return claim ? false : null;
    if (document.status !== "active") return false;
    let projectId: string | null = null;
    if (document.settlementId) {
      projectId = (await tx.settlement.findUnique({
        where: { id: document.settlementId }, select: { projectId: true }
      }))?.projectId ?? null;
    } else if (document.settlementDraftId) {
      projectId = (await tx.settlementDraft.findUnique({
        where: { id: document.settlementDraftId }, select: { projectId: true }
      }))?.projectId ?? null;
    }
    if (!projectId || ![
      "frozen_counterparty_copy",
      "counterparty_signed_original",
      "final_internal_signed_copy"
    ].includes(document.purpose)) return false;
    return this.hasProjectRole(tx, actorUserId, projectId, ARCHIVE_FILE_DOWNLOAD_ROLES);
  }

  private async governedContractFileAccess(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ): Promise<boolean | null> {
    const clients = tx as unknown as {
      contractFormalFile?: Prisma.TransactionClient["contractFormalFile"];
      contractAuthorization?: Prisma.TransactionClient["contractAuthorization"];
      pdfDocument?: Prisma.TransactionClient["pdfDocument"];
      contractSealTask?: Prisma.TransactionClient["contractSealTask"];
    };
    if (!clients.contractFormalFile || !clients.contractAuthorization ||
      !clients.pdfDocument || !clients.contractSealTask) return null;

    const [formal, authorization, approvalForm] = await Promise.all([
      clients.contractFormalFile.findFirst({ where: { fileId } }),
      clients.contractAuthorization.findFirst({ where: { fileId } }),
      clients.pdfDocument.findFirst({
        where: { fileId, templateKey: "approval_form", businessType: "contract_version" }
      })
    ]);
    const versionId = formal?.contractVersionId ??
      authorization?.originContractVersionId ?? approvalForm?.businessId;
    if (!versionId) return null;
    if (formal && formal.status !== "active") return false;
    if (authorization && authorization.status !== "active") return false;

    const version = await tx.contractVersion.findUnique({
      where: { id: versionId },
      select: { id: true, contractId: true }
    });
    const contract = version ? await tx.contract.findUnique({
      where: { id: version.contractId },
      select: { projectId: true, ownerUserId: true, voidedAt: true }
    }) : null;
    if (!contract || contract.voidedAt) return false;
    if (contract.ownerUserId === actorUserId) return true;

    const instance = approvalForm?.approvalInstanceId
      ? await tx.approvalInstance.findUnique({ where: { id: approvalForm.approvalInstanceId } })
      : await tx.approvalInstance.findFirst({
          where: { businessType: "contract_version", businessId: version!.id },
          orderBy: { updatedAt: "desc" }
        });
    if (instance?.applicantUserId === actorUserId) return true;
    if (instance && await tx.approvalActionLog.findFirst({
      where: { approvalInstanceId: instance.id, actorUserId, action: "approve" }
    })) return true;

    const sealTask = await clients.contractSealTask.findFirst({
      where: { contractVersionId: version!.id, status: { not: "cancelled" } },
      orderBy: { createdAt: "desc" }
    });
    if (sealTask?.handlerUserId === actorUserId) return true;
    if (formal?.uploadedByUserId === actorUserId || formal?.confirmedByUserId === actorUserId) {
      return true;
    }

    const roles = await this.loadActorRoleKeys(tx, actorUserId, contract.projectId);
    const exactReaders = new Set<RoleKey>([
      "contract_staff",
      "contract_director",
      "project_manager",
      "finance_staff",
      "finance_director",
      "comprehensive_director",
      "chairman",
      "general_manager"
    ]);
    return roles.some((role) => exactReaders.has(role));
  }

  private async resolveApprovalProjectId(
    tx: Prisma.TransactionClient,
    businessType: string,
    businessId: string
  ): Promise<string | null> {
    if (businessType === "settlement") {
      const settlement = await tx.settlement.findUnique({ where: { id: businessId } });
      return settlement?.projectId ?? null;
    }
    if (businessType === "payment_request") {
      const payment = await tx.paymentRequest.findUnique({ where: { id: businessId } });
      return payment?.projectId ?? null;
    }
    if (businessType === "project_expense_request") {
      const expense = await tx.projectExpenseRequest.findUnique({ where: { id: businessId } });
      return expense?.projectId ?? null;
    }
    if (businessType === "expense_claim") {
      const expense = await tx.expenseClaim.findUnique({
        where: { id: businessId },
        select: { projectId: true }
      });
      return expense?.projectId ?? null;
    }
    if (businessType === "contract_takeover") {
      const takeover = await tx.contractTakeover.findUnique({
        where: { id: businessId },
        select: { projectId: true }
      });
      return takeover?.projectId ?? null;
    }
    if (businessType === "contract_version") {
      const version = await tx.contractVersion.findUnique({ where: { id: businessId } });
      const contract = version
        ? await tx.contract.findUnique({ where: { id: version.contractId } })
        : null;
      return contract?.projectId ?? null;
    }
    return null;
  }

  private async hasProjectRole(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string,
    allowedRoles: readonly RoleKey[]
  ) {
    const roleKeys = await this.loadActorRoleKeys(tx, actorUserId, projectId);
    return roleKeys.some((role) => allowedRoles.includes(role));
  }

  private async hasGlobalRole(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    allowedRoles: readonly RoleKey[]
  ) {
    const clients = tx as unknown as {
      userPosition?: Prisma.TransactionClient["userPosition"];
      position?: Prisma.TransactionClient["position"];
    };
    if (!clients.userPosition || !clients.position) return false;
    const assignments = await clients.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await clients.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    return positions.some((position) => allowedRoles.includes(position.key as RoleKey));
  }

  private async loadActorRoleKeys(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeys = positions.map((position) => position.key as RoleKey);
    const memberKeys = projectMembers.map((member) => member.positionKey as RoleKey);

    return Array.from(new Set([...positionKeys, ...memberKeys]));
  }

  private signDownloadToken(
    fileId: string,
    actorUserId: string,
    expiresAt: string,
    downloadReason: string,
    accessMode: FileTicketAccessMode
  ) {
    return createHmac("sha256", this.downloadSecret())
      .update(`${fileId}.${actorUserId}.${expiresAt}.${downloadReason}.${accessMode}`)
      .digest("base64url");
  }

  private verifyDownloadToken(
    fileId: string,
    actorUserId: string,
    expiresAt: string,
    downloadReason: string,
    accessMode: FileTicketAccessMode,
    token: string
  ) {
    const expected = Buffer.from(
      this.signDownloadToken(fileId, actorUserId, expiresAt, downloadReason, accessMode)
    );
    const actual = Buffer.from(token);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  // 仅兼容改造发布前五分钟内已签发且 URL 未携带 accessMode 的下载票据；
  // 新票据和所有预览票据都必须验证包含访问方式的新签名。
  private verifyLegacyDownloadToken(
    fileId: string,
    actorUserId: string,
    expiresAt: string,
    downloadReason: string,
    token: string
  ) {
    const expected = Buffer.from(
      createHmac("sha256", this.downloadSecret())
        .update(`${fileId}.${actorUserId}.${expiresAt}.${downloadReason}`)
        .digest("base64url")
    );
    const actual = Buffer.from(token);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private downloadSecret() {
    if (process.env.NODE_ENV === "test") {
      return process.env.FILE_DOWNLOAD_SECRET ?? "test-file-download-secret";
    }
    return this.validatedDownloadSecret();
  }

  private assertDownloadSecret() {
    if (process.env.NODE_ENV === "test") return;
    this.validatedDownloadSecret();
  }

  private validatedDownloadSecret() {
    const value = process.env.FILE_DOWNLOAD_SECRET?.trim();
    const isDefault =
      !value ||
      value === "local-file-secret" ||
      value === "local-access-secret" ||
      value === "replace-with-long-random-file-download-secret";

    if (isDefault || value.length < 32) {
      throw new Error("FILE_DOWNLOAD_SECRET must be set to a non-default secret");
    }
    return value;
  }
}

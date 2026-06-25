import { Injectable } from "@nestjs/common";
import { type FileObject, Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

export interface UploadPrivateFileInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  buffer: Buffer;
}

export interface ReadPrivateFileInput {
  actorUserId: string;
  expiresAt: string;
  token: string;
}

export interface CreateFileDownloadTicketInput {
  actorUserId: string;
}

export interface InternalFileBuffer {
  file: FileObject;
  buffer: Buffer;
}

const ARCHIVE_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = [
  "contract_staff",
  "contract_director",
  "finance_staff",
  "finance_director"
];

const PAYMENT_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = ["finance_staff", "finance_director"];
const ALLOWED_EXTENSIONS = new Set([".docx", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg"]);

@Injectable()
export class PrivateFileStorage {
  private readonly root = resolve(
    process.env.FILE_STORAGE_ROOT ?? join(process.cwd(), "storage", "private")
  );

  async write(objectKey: string, buffer: Buffer) {
    if (this.useCos()) {
      await this.cosRequest("PUT", objectKey, buffer);
      return;
    }

    const target = this.resolveObjectKey(objectKey);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, buffer);
  }

  async read(objectKey: string) {
    if (this.useCos()) {
      return this.cosRequest("GET", objectKey);
    }

    return readFile(this.resolveObjectKey(objectKey));
  }

  bucketName() {
    return this.useCos() ? this.requiredEnv("COS_BUCKET") : "private-local";
  }

  private resolveObjectKey(objectKey: string) {
    const target = resolve(this.root, objectKey);
    const rootPrefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (target !== this.root && !target.startsWith(rootPrefix)) {
      throw new Error("Invalid private file object key");
    }

    return target;
  }

  private useCos() {
    return process.env.FILE_STORAGE_DRIVER === "cos";
  }

  private async cosRequest(method: "GET" | "PUT", objectKey: string, body?: Buffer) {
    // ponytail: direct COS XML PUT/GET; switch to SDK when multipart/resumable upload matters.
    const bucket = this.requiredEnv("COS_BUCKET");
    const region = this.requiredEnv("COS_REGION");
    const host = `${bucket}.cos.${region}.myqcloud.com`;
    const pathname = encodeURI(`/${objectKey}`);
    const response = await fetch(`https://${host}${pathname}`, {
      method,
      headers: {
        Authorization: this.cosAuthorization(method, pathname, host),
        Host: host
      },
      body: body ? new Uint8Array(body) : undefined
    });

    if (!response.ok) {
      throw new Error(`COS private file ${method} failed: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private cosAuthorization(method: "GET" | "PUT", pathname: string, host: string) {
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

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    private readonly storage: PrivateFileStorage = new PrivateFileStorage()
  ) {}

  async uploadPrivateFile(input: UploadPrivateFileInput) {
    if (!input.uploadedByUserId.trim()) {
      throw new Error("Uploaded user id is required");
    }

    if (!input.buffer.length || input.sizeBytes <= 0) {
      throw new Error("Private file is empty");
    }

    if (input.sizeBytes > Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)) {
      throw new Error("Private file exceeds upload size limit");
    }

    if (!ALLOWED_EXTENSIONS.has(extname(input.originalName).toLowerCase())) {
      throw new Error("Private file extension is not allowed");
    }

    const objectKey = `uploads/${randomUUID()}-${this.safeFileName(input.originalName)}`;
    await this.storage.write(objectKey, input.buffer);

    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.create({
        data: {
          bucket: this.storage.bucketName(),
          objectKey,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: input.uploadedByUserId
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

      return file;
    });
  }

  async createDownloadTicket(fileId: string, input: CreateFileDownloadTicketInput) {
    if (!input.actorUserId.trim()) {
      throw new Error("Actor user id is required");
    }

    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.findUnique({
        where: { id: fileId }
      });

      if (!file) {
        throw new Error("Private file not found");
      }

      await this.assertCanDownloadFileObject(tx, file, input.actorUserId);

      const expiresAtMs = Date.now() + 5 * 60 * 1000;
      const expiresAt = new Date(expiresAtMs).toISOString();
      const token = this.signDownloadToken(file.id, input.actorUserId, expiresAt);
      await this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: "file.download.ticket",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          expiresAt
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
        )}&token=${encodeURIComponent(token)}`
      };
    });
  }

  async readPrivateFile(fileId: string, input: ReadPrivateFileInput) {
    if (!input.actorUserId.trim()) {
      throw new Error("Actor user id is required");
    }

    if (Number.isNaN(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) < Date.now()) {
      throw new Error("Private file download ticket expired");
    }

    if (!this.verifyDownloadToken(fileId, input.actorUserId, input.expiresAt, input.token)) {
      throw new Error("Invalid private file download token");
    }

    const file = await this.prisma.$transaction(async (tx) => {
      const found = await tx.fileObject.findUnique({
        where: { id: fileId }
      });

      if (!found) {
        throw new Error("Private file not found");
      }

      await this.assertCanDownloadFileObject(tx, found, input.actorUserId);
      return found;
    });

    const buffer = await this.storage.read(file.objectKey);
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: "file.download",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          originalName: file.originalName,
          sizeBytes: file.sizeBytes
        }
      })
    );

    return {
      file,
      buffer
    };
  }

  // 内部服务读取，不走用户下载权限与审计。
  async getFileBuffer(fileId: string): Promise<InternalFileBuffer> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new Error("Private file not found");
    }
    return { file, buffer: await this.storage.read(file.objectKey) };
  }

  // 供其它模块（如审批单下载）按 fileId 复用下载权限校验。
  async assertCanDownloadFileById(fileId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertCanDownloadFile(tx, fileId, actorUserId);
    });
  }

  async assertCanDownloadFile(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ) {
    const file = await tx.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new Error("Private file not found");
    }
    await this.assertCanDownloadFileObject(tx, file, actorUserId);
    return file;
  }

  private safeFileName(fileName: string) {
    const name = basename(fileName).replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_");
    return name || "private-file";
  }

  private async assertCanDownloadFileObject(
    tx: Prisma.TransactionClient,
    file: FileObject,
    actorUserId: string
  ) {
    if (file.uploadedByUserId === actorUserId) {
      return;
    }

    const contractArchiveFile = await tx.contractArchiveFile.findFirst({
      where: { fileId: file.id }
    });
    if (contractArchiveFile) {
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

    // 审批单 PDF：申请人、任一签批人，或该项目的归档可读岗位均可下载。
    const approvalForm = await tx.pdfDocument.findFirst({
      where: { fileId: file.id, templateKey: "approval_form" }
    });
    if (approvalForm) {
      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: approvalForm.businessType,
          businessId: approvalForm.businessId,
          status: "approved"
        },
        orderBy: { updatedAt: "desc" }
      });

      if (instance) {
        if (instance.applicantUserId === actorUserId) {
          return;
        }

        const signed = await tx.approvalActionLog.findFirst({
          where: { approvalInstanceId: instance.id, actorUserId }
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
    }

    throw new Error("Actor cannot download private file");
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

  private signDownloadToken(fileId: string, actorUserId: string, expiresAt: string) {
    return createHmac("sha256", this.downloadSecret())
      .update(`${fileId}.${actorUserId}.${expiresAt}`)
      .digest("base64url");
  }

  private verifyDownloadToken(fileId: string, actorUserId: string, expiresAt: string, token: string) {
    const expected = Buffer.from(this.signDownloadToken(fileId, actorUserId, expiresAt));
    const actual = Buffer.from(token);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private downloadSecret() {
    return process.env.FILE_DOWNLOAD_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "local-file-secret";
  }
}

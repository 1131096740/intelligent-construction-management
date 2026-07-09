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
  downloadReason?: string;
}

export interface CreateFileDownloadTicketInput {
  actorUserId: string;
  downloadReason?: string;
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
const UPSTREAM_SETTLEMENT_FILE_DOWNLOAD_ROLES: readonly RoleKey[] = ["budget_staff", "budget_director"];
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
const ALLOWED_EXTENSIONS = new Set([".docx", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg"]);

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

function normalizeDownloadReason(value: string | undefined): string {
  const reason = value?.trim();
  if (!reason) {
    throw new Error("请填写下载原因，便于留痕审计");
  }
  if (reason.length > 200) {
    throw new Error("下载原因不能超过 200 个字，请精简后重新提交");
  }
  return reason;
}

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    private readonly storage: PrivateFileStorage = new PrivateFileStorage()
  ) {
    this.assertDownloadSecret();
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
      throw new Error("下载人信息缺失，请重新登录后再下载资料");
    }
    const downloadReason = normalizeDownloadReason(input.downloadReason);

    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.findUnique({
        where: { id: fileId }
      });

      if (!file) {
        throw new Error("资料文件不存在或已被移除");
      }

      await this.assertCanDownloadFileObject(tx, file, input.actorUserId);

      const expiresAtMs = Date.now() + 5 * 60 * 1000;
      const expiresAt = new Date(expiresAtMs).toISOString();
      const token = this.signDownloadToken(file.id, input.actorUserId, expiresAt, downloadReason);
      await this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: "file.download.ticket",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          expiresAt,
          downloadReason
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
        )}&token=${encodeURIComponent(token)}`
      };
    });
  }

  async readPrivateFile(fileId: string, input: ReadPrivateFileInput) {
    if (!input.actorUserId.trim()) {
      throw new Error("下载人信息缺失，请重新登录后再下载资料");
    }

    if (Number.isNaN(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) < Date.now()) {
      throw new Error("下载链接已过期，请重新申请下载");
    }
    const downloadReason = normalizeDownloadReason(input.downloadReason);

    if (
      !this.verifyDownloadToken(
        fileId,
        input.actorUserId,
        input.expiresAt,
        downloadReason,
        input.token
      )
    ) {
      throw new Error("下载链接校验失败，请重新申请下载");
    }

    const file = await this.prisma.$transaction(async (tx) => {
      const found = await tx.fileObject.findUnique({
        where: { id: fileId }
      });

      if (!found) {
        throw new Error("资料文件不存在或已被移除");
      }

      await this.assertCanDownloadFileObject(tx, found, input.actorUserId);
      return found;
    });

    let buffer: Buffer;
    try {
      buffer = await this.storage.read(file.objectKey);
    } catch {
      throw new Error("资料文件暂时无法读取，请稍后重试或联系管理员核对私有存储");
    }
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: "file.download",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          originalName: file.originalName,
          sizeBytes: file.sizeBytes,
          downloadReason
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
      throw new Error("资料文件不存在或已被移除");
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
      throw new Error("资料文件不存在或已被移除");
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
      throw new Error("当前账号无权下载该资料");
    }

    if (file.uploadedByUserId === actorUserId && !projectOwnerContract) {
      return;
    }

    const contractArchiveFile = await tx.contractArchiveFile.findFirst({
      where: { fileId: file.id }
    });
    if (contractArchiveFile) {
      if (contractArchiveFile.status !== "confirmed") {
        throw new Error("资料尚未归档确认，暂不能下载");
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
        throw new Error("资料尚未归档确认，暂不能下载");
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
          where: { voucherFileId: string; voidedAt: null };
          select: { projectId: true };
        }) => Promise<{ projectId: string } | null>;
      };
    }).projectUpstreamSettlement;
    const projectUpstreamSettlement = projectUpstreamSettlementClient
      ? await projectUpstreamSettlementClient.findFirst({
          where: { voucherFileId: file.id, voidedAt: null },
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
      where: { fileId: file.id, templateKey: { in: ["approval_form", "settlement_approval_latest"] } }
    });
    if (approvalForm) {
      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: approvalForm.businessType,
          businessId: approvalForm.businessId,
          status:
            approvalForm.templateKey === "approval_form"
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

    throw new Error("当前账号无权下载该资料");
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
    downloadReason: string
  ) {
    return createHmac("sha256", this.downloadSecret())
      .update(`${fileId}.${actorUserId}.${expiresAt}.${downloadReason}`)
      .digest("base64url");
  }

  private verifyDownloadToken(
    fileId: string,
    actorUserId: string,
    expiresAt: string,
    downloadReason: string,
    token: string
  ) {
    const expected = Buffer.from(
      this.signDownloadToken(fileId, actorUserId, expiresAt, downloadReason)
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

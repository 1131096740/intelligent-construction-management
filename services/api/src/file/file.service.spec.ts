import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger
} from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService, PrivateFileStorage } from "./file.service";
import { SpotProcurementAccessService } from "../spot-procurement/spot-procurement-access.service";

const STORAGE_ENV_KEYS = [
  "FILE_STORAGE_DRIVER",
  "FILE_STORAGE_ROOT",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_BUCKET",
  "COS_REGION"
] as const;

function snapshotStorageEnv() {
  return Object.fromEntries(STORAGE_ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
    (typeof STORAGE_ENV_KEYS)[number],
    string | undefined
  >;
}

function restoreStorageEnv(snapshot: ReturnType<typeof snapshotStorageEnv>) {
  STORAGE_ENV_KEYS.forEach((key) => {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}

function configureCosStorage() {
  process.env.FILE_STORAGE_DRIVER = "cos";
  process.env.COS_SECRET_ID = "secret-id";
  process.env.COS_SECRET_KEY = "secret-key";
  process.env.COS_BUCKET = "private-bucket";
  process.env.COS_REGION = "ap-guangzhou";
}

describe("FileService", () => {
  const audit = {
    record: jest.fn()
  };
  const storage = {
    write: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
    bucketName: jest.fn()
  };

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    audit.record.mockReset();
    storage.write.mockReset();
    storage.read.mockReset();
    storage.delete.mockReset();
    storage.bucketName.mockReset();
    storage.bucketName.mockReturnValue("private-local");
    jest
      .spyOn(SpotProcurementAccessService.prototype, "resolveFileDownloadAccess")
      .mockResolvedValue("not_spot");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("denies a generated upload that is still owned by an incomplete settlement claim", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const tx = {
      settlementSignedDocumentGenerationClaim: {
        findFirst: jest.fn().mockResolvedValue({ status: "uploaded" })
      },
      settlementSignedDocument: { findFirst: jest.fn() }
    };

    await expect((service as unknown as {
      assertCanDownloadFileObject(tx: unknown, file: { id: string; uploadedByUserId: string }, actor: string): Promise<void>;
    }).assertCanDownloadFileObject(tx, { id: "generated-1", uploadedByUserId: "actor-1" }, "actor-1"))
      .rejects.toThrow("当前账号无权下载该结算签章资料");
    expect(tx.settlementSignedDocument.findFirst).not.toHaveBeenCalled();
  });

  it("authorizes an active final settlement document only through its project ACL", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const tx = {
      settlementSignedDocumentGenerationClaim: { findFirst: jest.fn().mockResolvedValue({ status: "completed" }) },
      settlementSignedDocument: { findFirst: jest.fn().mockResolvedValue({
        status: "active", purpose: "final_internal_signed_copy", settlementId: "settlement-1", settlementDraftId: null
      }) },
      settlement: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };

    await expect((service as unknown as {
      assertCanDownloadFileObject(tx: unknown, file: { id: string; uploadedByUserId: string }, actor: string): Promise<void>;
    }).assertCanDownloadFileObject(tx, { id: "generated-1", uploadedByUserId: "other" }, "finance-1"))
      .resolves.toBeUndefined();
  });

  it("registers a generated file and advances its settlement claim in one transaction", async () => {
    const claimUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      fileObject: { create: jest.fn().mockResolvedValue({
        id: "generated-file-1", bucket: "private-local", objectKey: "object-1",
        originalName: "final.pdf", sizeBytes: 3
      }) },
      settlementSignedDocumentGenerationClaim: { updateMany: claimUpdate }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await service.uploadPrivateFile({
      originalName: "final.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      uploadedByUserId: "contract-director-1",
      buffer: Buffer.from("pdf"),
      settlementSignedDocumentGenerationClaim: {
        settlementId: "settlement-1", claimToken: "123e4567-e89b-42d3-a456-426614174000"
      }
    });

    expect(claimUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        settlementId: "settlement-1", claimToken: "123e4567-e89b-42d3-a456-426614174000", status: "pending"
      }),
      data: expect.objectContaining({ status: "uploaded", uploadedFileId: "generated-file-1" })
    }));
    expect(storage.write).toHaveBeenCalledWith(
      "uploads/settlement-signed-generation/123e4567-e89b-42d3-a456-426614174000.pdf",
      Buffer.from("pdf")
    );
  });

  it("deletes only the stale claim token deterministic object during takeover cleanup", async () => {
    const service = new FileService(
      {} as PrismaService, audit as unknown as AuditService, storage as unknown as PrivateFileStorage
    );
    await service.discardSettlementClaimObject("123e4567-e89b-42d3-a456-426614174000");
    expect(storage.delete).toHaveBeenCalledWith(
      "uploads/settlement-signed-generation/123e4567-e89b-42d3-a456-426614174000.pdf"
    );
  });

  it("keeps an already-linked generated file when cleanup observes the committed reference", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: true }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-linked", uploadedByUserId: "actor-1", storageStatus: "active",
          objectKey: "uploads/file-linked.pdf"
        }),
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await service.discardUnlinkedGeneratedFile("file-linked", "actor-1");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("accepts only the actor's active unlinked file as a new correction attachment", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: false }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "fresh-file",
          uploadedByUserId: "contract-user",
          storageStatus: "active"
        })
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.assertCanAttachUnlinkedFile(
      tx as never,
      "fresh-file",
      "contract-user"
    )).resolves.toMatchObject({ id: "fresh-file" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects a correction attachment already bound to another business", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: true }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "bound-file",
          uploadedByUserId: "contract-user",
          storageStatus: "active"
        })
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.assertCanAttachUnlinkedFile(
      tx as never,
      "bound-file",
      "contract-user"
    )).rejects.toThrow("该文件已用于其他业务，请重新上传专用的更正依据附件");
  });

  it("locks and accepts an active private historical-takeover file with no binding", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: false }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-voucher-1",
          uploadedByUserId: "finance-user",
          storageStatus: "active"
        })
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertCanUseHistoricalTakeoverFile(
        tx as never,
        "takeover-voucher-1",
        "finance-user",
        false
      )
    ).resolves.toMatchObject({ id: "takeover-voucher-1" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("allows a locked historical-takeover file already bound to this draft", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "existing-takeover-voucher",
          uploadedByUserId: "finance-user",
          storageStatus: "active"
        })
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertCanUseHistoricalTakeoverFile(
        tx as never,
        "existing-takeover-voucher",
        "finance-user",
        true
      )
    ).resolves.toMatchObject({ id: "existing-takeover-voucher" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("rejects a historical-takeover file already bound to another business", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: true }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cross-bound-file",
          uploadedByUserId: "finance-user",
          storageStatus: "active"
        })
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertCanUseHistoricalTakeoverFile(
        tx as never,
        "cross-bound-file",
        "finance-user",
        false
      )
    ).rejects.toThrow("该文件已绑定其他业务记录，不能用于历史接管");
  });

  it("discards and deletes a generated file only after the locked reference check stays empty", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: false }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-orphan", uploadedByUserId: "actor-1", storageStatus: "active",
          objectKey: "uploads/file-orphan.pdf"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await service.discardUnlinkedGeneratedFile("file-orphan", "actor-1");

    expect(tx.fileObject.updateMany).toHaveBeenCalledWith({
      where: { id: "file-orphan", uploadedByUserId: "actor-1", storageStatus: "active" },
      data: { storageStatus: "discarded" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "file.generated_orphan.discard", businessId: "file-orphan"
    }));
    expect(storage.delete).toHaveBeenCalledWith("uploads/file-orphan.pdf");
  });

  it("deduplicates generated-file cleanup and processes it in a stable order", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const discard = jest
      .spyOn(service, "discardUnlinkedGeneratedFile")
      .mockResolvedValue(undefined);

    await service.discardUnlinkedGeneratedFiles(
      ["pdf-file", "docx-file", "pdf-file"],
      "actor-1"
    );

    expect(discard).toHaveBeenNthCalledWith(1, "docx-file", "actor-1");
    expect(discard).toHaveBeenNthCalledWith(2, "pdf-file", "actor-1");
  });

  it("keeps the discarded state when orphan storage deletion fails", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: false }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-cleanup-failed", uploadedByUserId: "actor-1", storageStatus: "active",
          objectKey: "uploads/file-cleanup-failed.pdf"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.delete.mockRejectedValue(new Error("cleanup failed"));

    await expect(service.discardUnlinkedGeneratedFile("file-cleanup-failed", "actor-1"))
      .resolves.toBeUndefined();

    expect(tx.fileObject.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.fileObject.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { storageStatus: "discarded" }
    }));
  });

  it("does not delete after a concurrent cleanup loses the active-state CAS", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ referenced: false }]),
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-raced", uploadedByUserId: "actor-1", storageStatus: "active",
          objectKey: "uploads/file-raced.pdf"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await service.discardUnlinkedGeneratedFile("file-raced", "actor-1");

    expect(audit.record).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("does not let super_admin bypass a governed contract formal-file ACL", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const tx = {
      contractFormalFile: { findFirst: jest.fn().mockResolvedValue({
        contractVersionId: "version-1",
        status: "active",
        uploadedByUserId: "handler-1",
        confirmedByUserId: null
      }) },
      contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      contractSealTask: { findFirst: jest.fn().mockResolvedValue({ handlerUserId: "handler-1" }) },
      contractVersion: { findUnique: jest.fn().mockResolvedValue({
        id: "version-1",
        contractId: "contract-1",
        status: "approved_pending_seal"
      }) },
      contract: { findUnique: jest.fn().mockResolvedValue({
        projectId: "project-1",
        ownerUserId: "owner-1",
        voidedAt: null
      }) },
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(null) },
      approvalActionLog: { findFirst: jest.fn() },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "super" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([{ id: "super", key: "super_admin" }]) }
    };

    await expect((service as unknown as {
      assertCanDownloadFileObject(tx: unknown, file: { id: string }, actor: string): Promise<void>;
    }).assertCanDownloadFileObject(tx, { id: "formal-file-1" }, "admin-1"))
      .rejects.toThrow("当前账号无权下载该合同签署资料");
  });

  it("拒绝真实冻结审批人通过通用文件票据下载无水印合同审批单", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const tx = {
      contractFormalFile: { findFirst: jest.fn().mockResolvedValue(null) },
      contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue({
        businessType: "contract_version",
        templateKey: "approval_form",
        businessId: "version-1",
        approvalInstanceId: "instance-1"
      }) },
      contractSealTask: { findFirst: jest.fn().mockResolvedValue(null) },
      contractVersion: { findUnique: jest.fn().mockResolvedValue({
        id: "version-1",
        contractId: "contract-1",
        status: "approved_pending_seal"
      }) },
      contract: { findUnique: jest.fn().mockResolvedValue({
        projectId: "project-1",
        ownerUserId: "owner-1",
        voidedAt: null
      }) },
      approvalInstance: { findFirst: jest.fn().mockResolvedValue({
        id: "instance-1",
        applicantUserId: "applicant-1",
        status: "approved"
      }) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "action-1" }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };

    await expect((service as unknown as {
      assertCanDownloadFileObject(tx: unknown, file: { id: string }, actor: string): Promise<void>;
    }).assertCanDownloadFileObject(tx, { id: "approval-form-1" }, "approver-1"))
      .rejects.toThrow("审批单必须通过专用下载入口下载");
    expect(tx.approvalActionLog.findFirst).not.toHaveBeenCalled();
  });

  it("仅有催办或转审日志的人不能绕过合同审批单票据 ACL", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const approvalActionLookup = jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(where.action === "remind" ? { id: "remind-1" } : null)
    );
    const tx = {
      contractFormalFile: { findFirst: jest.fn().mockResolvedValue(null) },
      contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue({
        businessType: "contract_version",
        templateKey: "approval_form",
        businessId: "version-1",
        approvalInstanceId: "instance-1"
      }) },
      contractSealTask: { findFirst: jest.fn().mockResolvedValue(null) },
      contractVersion: { findUnique: jest.fn().mockResolvedValue({
        id: "version-1",
        contractId: "contract-1",
        status: "approved_pending_seal"
      }) },
      contract: { findUnique: jest.fn().mockResolvedValue({
        projectId: "project-1",
        ownerUserId: "owner-1",
        voidedAt: null
      }) },
      approvalInstance: { findFirst: jest.fn().mockResolvedValue({
        id: "instance-1",
        applicantUserId: "applicant-1",
        status: "approved"
      }) },
      approvalActionLog: { findFirst: approvalActionLookup },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };

    await expect((service as unknown as {
      assertCanDownloadFileObject(tx: unknown, file: { id: string }, actor: string): Promise<void>;
    }).assertCanDownloadFileObject(tx, { id: "approval-form-1" }, "reminder-1"))
      .rejects.toThrow("审批单必须通过专用下载入口下载");
    expect(approvalActionLookup).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: "合同退回草稿后",
      versionStatus: "draft",
      latestApprovalId: "instance-old-approved",
      latestApprovalStatus: "approved"
    },
    {
      caseName: "合同重新发起审批后",
      versionStatus: "in_approval",
      latestApprovalId: "instance-new-in-progress",
      latestApprovalStatus: "in_progress"
    },
    {
      caseName: "新一轮审批通过但旧审批单仍被引用时",
      versionStatus: "approved_pending_seal",
      latestApprovalId: "instance-new-approved",
      latestApprovalStatus: "approved"
    },
    {
      caseName: "当前审批已通过且审批单实例绑定正确时",
      versionStatus: "approved_pending_seal",
      latestApprovalId: "instance-old-approved",
      latestApprovalStatus: "approved"
    }
  ])(
    "$caseName不能通过通用文件票据下载旧合同审批单",
    async ({ versionStatus, latestApprovalId, latestApprovalStatus }) => {
      const tx = {
        fileObject: {
          findUnique: jest.fn().mockResolvedValue({
            id: "approval-form-file-1",
            bucket: "private-local",
            objectKey: "generated/approval-form-file-1.pdf",
            originalName: "合同审批单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12,
            uploadedByUserId: "system-1"
          })
        },
        contractFormalFile: { findFirst: jest.fn().mockResolvedValue(null) },
        contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
        pdfDocument: {
          findFirst: jest.fn().mockResolvedValue({
            businessType: "contract_version",
            businessId: "version-1",
            templateKey: "approval_form",
            approvalInstanceId: "instance-old-approved"
          })
        },
        contractSealTask: { findFirst: jest.fn().mockResolvedValue(null) },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "version-1",
            contractId: "contract-1",
            status: versionStatus
          })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            projectId: "project-1",
            ownerUserId: "owner-1",
            voidedAt: null
          })
        },
        approvalInstance: {
          findFirst: jest.fn().mockResolvedValue({
            id: latestApprovalId,
            applicantUserId: "owner-1",
            status: latestApprovalStatus
          })
        }
      };
      const prisma = {
        $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx)
        )
      } as unknown as PrismaService;
      const service = new FileService(
        prisma,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );

      await expect(
        service.createDownloadTicket("approval-form-file-1", {
          actorUserId: "owner-1",
          downloadReason: "合同审批单复核"
        })
      ).rejects.toThrow("审批单必须通过专用下载入口下载");
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it.each(["uploaded", "failed"])(
    "拒绝上传者通过通用文件票据下载 %s 的合同审批单生成中间文件",
    async (claimStatus) => {
      const tx = {
        fileObject: {
          findUnique: jest.fn().mockResolvedValue({
            id: "approval-form-claim-file-1",
            bucket: "private-local",
            objectKey: "generated/approval-form-claim-file-1.pdf",
            originalName: "合同审批单中间文件.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12,
            uploadedByUserId: "contract-director-1"
          })
        },
        contractFormalFile: { findFirst: jest.fn().mockResolvedValue(null) },
        contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
        pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
        contractSealTask: { findFirst: jest.fn().mockResolvedValue(null) },
        approvalFormGenerationClaim: {
          findFirst: jest.fn().mockResolvedValue({
            approvalInstanceId: "instance-old-approved",
            status: claimStatus,
            pdfDocumentId: null
          })
        }
      };
      const prisma = {
        $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx)
        )
      } as unknown as PrismaService;
      const service = new FileService(
        prisma,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );

      await expect(
        service.createDownloadTicket("approval-form-claim-file-1", {
          actorUserId: "contract-director-1",
          downloadReason: "合同审批单复核"
        })
      ).rejects.toThrow("审批单必须通过专用下载入口下载");
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it.each(["spot_procurement_version", "spot_procurement_payment"])(
    "拒绝通过通用文件票据下载 %s 的零采无水印原始审批单",
    async (businessType) => {
      const spotAccess = {
        resolveFileDownloadAccess: jest.fn()
      };
      const service = new FileService(
        {} as PrismaService,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage,
        spotAccess as unknown as SpotProcurementAccessService
      );
      const tx = {
        pdfDocument: {
          findFirst: jest.fn().mockResolvedValue({
            id: "spot-pdf-1",
            businessType,
            businessId: "spot-business-1",
            templateKey: "spot_procurement_approval_original_v1"
          })
        },
        approvalFormGenerationClaim: {
          findFirst: jest.fn().mockResolvedValue(null)
        }
      };

      await expect((service as unknown as {
        assertCanDownloadFileObject(
          client: unknown,
          file: { id: string },
          actorUserId: string
        ): Promise<void>;
      }).assertCanDownloadFileObject(
        tx,
        { id: "spot-raw-approval-file-1" },
        "spot-applicant-1"
      )).rejects.toThrow("审批单必须通过专用下载入口下载");

      expect(spotAccess.resolveFileDownloadAccess).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["缺失 claim", null],
    ["claim 尚未完成", {
      status: "uploaded",
      uploadedFileId: "file-1",
      pdfDocumentId: "pdf-1"
    }],
    ["claim 文件坐标漂移", {
      status: "completed",
      uploadedFileId: "file-other",
      pdfDocumentId: "pdf-1"
    }],
    ["claim 文档坐标漂移", {
      status: "completed",
      uploadedFileId: "file-1",
      pdfDocumentId: "pdf-other"
    }]
  ])("拒绝%s的新式审批单归档锚点", async (_caseName, generationClaim) => {
    const archivedBuffer = Buffer.from("%PDF-approval-form");
    const prisma = {
      pdfDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: "pdf-1",
          fileId: "file-1",
          templateKey: "approval_form",
          businessType: "contract_version",
          businessId: "version-1",
          approvalInstanceId: "approval-1"
        })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          objectKey: "generated/file-1.pdf",
          storageStatus: "active",
          contentSha256: createHash("sha256").update(archivedBuffer).digest("hex")
        })
      },
      approvalFormGenerationClaim: {
        findUnique: jest.fn().mockResolvedValue(generationClaim)
      }
    };
    const privateStorage = {
      read: jest.fn().mockResolvedValue(archivedBuffer)
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      privateStorage as unknown as PrivateFileStorage
    );

    await expect(service.assertApprovalFormArchiveAnchor({
      pdfDocumentId: "pdf-1",
      fileId: "file-1",
      businessType: "contract_version",
      businessId: "version-1",
      approvalInstanceId: "approval-1"
    })).rejects.toThrow("审批单归档锚点已变化，请刷新后重新下载");

    expect(privateStorage.read).not.toHaveBeenCalled();
  });

  it("拒绝全局岗位下载无关私有文件", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const businessLookup = jest.fn().mockResolvedValue(null);
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "global-finance", positionId: "position-finance", projectId: null }
        ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-finance", key: "finance_staff" }
        ])
      },
      projectOwnerContract: { findFirst: businessLookup },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(tx, { id: "file-other-project" }, "global-finance")
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(businessLookup).toHaveBeenCalled();
  });

  it("保留全局财务岗位对已确认合同归档件的跨项目下载", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const tx = {
      userPosition: {
        findMany: jest.fn(({ where }: { where: { projectId: string | null } }) =>
          Promise.resolve(where.projectId === null ? [{ positionId: "position-finance" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-finance", key: "finance_staff" }
        ])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      projectOwnerContract: { findFirst: jest.fn().mockResolvedValue(null) },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          status: "confirmed",
          contractVersionId: "version-1"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-other" })
      },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };

    await expect((service as unknown as {
      assertCanDownloadFileObject(
        client: unknown,
        file: { id: string; uploadedByUserId: string },
        actorUserId: string
      ): Promise<void>;
    }).assertCanDownloadFileObject(
      tx,
      { id: "confirmed-archive", uploadedByUserId: "other-user" },
      "global-finance"
    )).resolves.toBeUndefined();
  });

  it("非合同审批单生成前仅允许申请人、已处理人或明确的归档读取岗位", async () => {
    const tx = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          applicantUserId: "applicant-1"
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentRequest: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-other" })
      },
      userPosition: {
        findMany: jest.fn(({ where }: { where: { projectId: string | null } }) =>
          Promise.resolve(where.projectId === null ? [{ positionId: "position-finance" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-finance", key: "finance_staff" }
        ])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.assertCanDownloadApprovalFormByBusiness(
      "payment_request",
      "payment-1",
      "global-finance"
    )).resolves.toBeUndefined();

    tx.userPosition.findMany.mockResolvedValue([]);
    tx.position.findMany.mockResolvedValue([]);
    await expect(service.assertCanDownloadApprovalFormByBusiness(
      "payment_request",
      "payment-1",
      "unrelated-user"
    )).rejects.toThrow("当前账号无权下载该审批单");
  });

  it("在审批单生成前拒绝未支持的业务类型", async () => {
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.assertCanDownloadApprovalFormByBusiness(
      "unknown_business",
      "business-1",
      "user-1"
    )).rejects.toThrow("当前业务类型不支持下载审批单");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["退回草稿", "draft", "approved"],
    ["新一轮审批中", "in_approval", "in_progress"]
  ])("合同%s时拒绝当前审批单下载授权", async (
    _label,
    versionStatus,
    latestApprovalStatus
  ) => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: versionStatus
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          ownerUserId: "owner-1",
          voidedAt: null
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "latest-approval",
          applicantUserId: "owner-1",
          status: latestApprovalStatus
        })
      },
      approvalActionLog: { findFirst: jest.fn() },
      userPosition: { findMany: jest.fn() },
      projectMember: { findMany: jest.fn() },
      position: { findMany: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.assertCanDownloadContractApprovalForm(
      "version-1",
      "owner-1"
    )).rejects.toThrow("当前合同尚未完成审批，暂不能下载审批单");
    expect(tx.approvalActionLog.findFirst).not.toHaveBeenCalled();
  });

  it("合同新一轮审批通过后按最新实例开放当前审批单", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "approved_pending_seal"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          ownerUserId: "owner-1",
          voidedAt: null
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "new-approved",
          applicantUserId: "owner-1",
          status: "approved"
        })
      },
      approvalActionLog: { findFirst: jest.fn() },
      userPosition: { findMany: jest.fn() },
      projectMember: { findMany: jest.fn() },
      position: { findMany: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.assertCanDownloadContractApprovalForm(
      "version-1",
      "owner-1"
    )).resolves.toBeUndefined();
    expect(tx.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: { businessType: "contract_version", businessId: "version-1" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
  });

  it("checks spot ownership before global-role and uploader shortcuts", async () => {
    const access = {
      resolveFileDownloadAccess: jest.fn().mockResolvedValue("denied")
    };
    const globalLookup = jest.fn();
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage,
      access as unknown as SpotProcurementAccessService
    );
    const tx = {
      userPosition: { findMany: globalLookup },
      position: { findMany: jest.fn() }
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string; uploadedByUserId: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(
        tx,
        { id: "spot-pending-pdf", uploadedByUserId: "global-uploader" },
        "global-uploader"
      )
    ).rejects.toThrow("当前账号无权下载该零星采购资料");
    expect(access.resolveFileDownloadAccess).toHaveBeenCalledWith(
      "spot-pending-pdf",
      "global-uploader",
      tx
    );
    expect(globalLookup).not.toHaveBeenCalled();
  });

  it("allows only an expense claim participant to download a new-domain expense attachment", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const tx = {
      expenseClaimAttachment: {
        findFirst: jest.fn().mockResolvedValue({
          expenseClaimId: "claim-1",
          attachedByUserId: "handler-1",
          removedAt: null
        })
      },
      expenseClaim: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handledByUserId: "handler-1",
          approvalInstanceId: null
        })
      }
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string; uploadedByUserId: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(tx, { id: "expense-file-1", uploadedByUserId: "uploader-1" }, "handler-1")
    ).resolves.toBeUndefined();
  });

  it("fails closed for a nonparticipant requesting a new-domain expense attachment", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const tx = {
      expenseClaimAttachment: {
        findFirst: jest.fn().mockResolvedValue({
          expenseClaimId: "claim-1",
          attachedByUserId: "handler-1",
          removedAt: null
        })
      },
      expenseClaim: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handledByUserId: "handler-1",
          approvalInstanceId: null
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string; uploadedByUserId: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(tx, { id: "expense-file-1", uploadedByUserId: "uploader-1" }, "stranger-1")
    ).rejects.toThrow("当前账号无权下载该费用附件");
  });

  it("allows a receipt-only file after checking that no other business binding exists", async () => {
    const access = {
      resolveFileDownloadAccess: jest
        .fn()
        .mockResolvedValue("allowed")
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage,
      access as unknown as SpotProcurementAccessService
    );
    const tx = {
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue({ id: "photo-1" })
      },
      spotProcurementRefund: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementPaymentInvoice: {
        findMany: jest.fn().mockResolvedValue([])
      },
      invoiceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      noInvoiceConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
      invoiceExceptionConfirmation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      $queryRaw: jest.fn().mockResolvedValue([])
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(
        tx,
        { id: "receipt-only-file" },
        "receipt-viewer"
      )
    ).resolves.toBeUndefined();
  });

  it("fails closed when an otherwise accessible receipt file has another business binding", async () => {
    const access = {
      resolveFileDownloadAccess: jest
        .fn()
        .mockResolvedValue("allowed")
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage,
      access as unknown as SpotProcurementAccessService
    );
    const tx = {
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue({ id: "photo-1" })
      },
      spotProcurementRefund: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementPaymentInvoice: {
        findMany: jest.fn().mockResolvedValue([])
      },
      invoiceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      noInvoiceConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
      invoiceExceptionConfirmation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ fileId: "mixed-binding-file" }])
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(
        tx,
        { id: "mixed-binding-file" },
        "receipt-viewer"
      )
    ).rejects.toThrow(
      "资料文件存在跨业务绑定冲突，暂不能下载"
    );
  });

  it("allows an accessible refund voucher when its refund is the only business binding", async () => {
    const access = {
      resolveFileDownloadAccess: jest.fn().mockResolvedValue("allowed")
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage,
      access as unknown as SpotProcurementAccessService
    );
    const tx = {
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      spotProcurementRefund: {
        findMany: jest.fn().mockResolvedValue([{ id: "refund-1" }])
      },
      spotProcurementPaymentInvoice: {
        findMany: jest.fn().mockResolvedValue([])
      },
      invoiceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      noInvoiceConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
      invoiceExceptionConfirmation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      $queryRaw: jest.fn().mockResolvedValue([])
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(
        tx,
        { id: "refund-only-voucher" },
        "refund-viewer"
      )
    ).resolves.toBeUndefined();
  });

  it("fails closed when an accessible refund voucher has another business binding", async () => {
    const access = {
      resolveFileDownloadAccess: jest.fn().mockResolvedValue("allowed")
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage,
      access as unknown as SpotProcurementAccessService
    );
    const tx = {
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      spotProcurementRefund: {
        findMany: jest.fn().mockResolvedValue([{ id: "refund-1" }])
      },
      spotProcurementPaymentInvoice: {
        findMany: jest.fn().mockResolvedValue([])
      },
      invoiceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      noInvoiceConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
      invoiceExceptionConfirmation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ fileId: "mixed-refund-voucher" }])
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(
        tx,
        { id: "mixed-refund-voucher" },
        "refund-viewer"
      )
    ).rejects.toThrow(
      "资料文件存在跨业务绑定冲突，暂不能下载"
    );
  });

  it.each([
    ["invoice_record", "InvoiceRecord.fileId"],
    ["no_invoice", "NoInvoiceConfirmation.proofFileId"],
    [
      "invoice_exception",
      "InvoiceExceptionConfirmation.proofFileId"
    ]
  ])(
    "allows an accessible %s evidence file when its exact binding is the only binding",
    async (kind) => {
      const access = {
        resolveFileDownloadAccess: jest.fn().mockResolvedValue("allowed")
      };
      const service = new FileService(
        {} as PrismaService,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage,
        access as unknown as SpotProcurementAccessService
      );
      const tx = {
        spotProcurementReceiptPhoto: {
          findFirst: jest.fn().mockResolvedValue(null)
        },
        spotProcurementRefund: {
          findMany: jest.fn().mockResolvedValue([])
        },
        spotProcurementPaymentInvoice: {
          findMany: jest.fn().mockResolvedValue([])
        },
        invoiceRecord: {
          findMany: jest
            .fn()
            .mockResolvedValue(kind === "invoice_record" ? [{ id: "invoice-1" }] : [])
        },
        noInvoiceConfirmation: {
          findMany: jest
            .fn()
            .mockResolvedValue(kind === "no_invoice" ? [{ id: "no-invoice-1" }] : [])
        },
        invoiceExceptionConfirmation: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              kind === "invoice_exception"
                ? [{ id: "invoice-exception-1" }]
                : []
            )
        },
        $queryRaw: jest.fn().mockResolvedValue([])
      };

      await expect(
        (
          service as unknown as {
            assertCanDownloadFileObject(
              client: unknown,
              file: { id: string },
              actorUserId: string
            ): Promise<void>;
          }
        ).assertCanDownloadFileObject(
          tx,
          { id: "invoice-evidence-file" },
          "invoice-viewer"
        )
      ).resolves.toBeUndefined();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["second_evidence_binding", "other_business_binding"])(
    "fails closed when accessible invoice evidence has %s",
    async (conflict) => {
      const access = {
        resolveFileDownloadAccess: jest.fn().mockResolvedValue("allowed")
      };
      const service = new FileService(
        {} as PrismaService,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage,
        access as unknown as SpotProcurementAccessService
      );
      const tx = {
        spotProcurementReceiptPhoto: {
          findFirst: jest.fn().mockResolvedValue(null)
        },
        spotProcurementRefund: {
          findMany: jest.fn().mockResolvedValue([])
        },
        spotProcurementPaymentInvoice: {
          findMany: jest.fn().mockResolvedValue([])
        },
        invoiceRecord: {
          findMany: jest.fn().mockResolvedValue([{ id: "invoice-1" }])
        },
        noInvoiceConfirmation: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              conflict === "second_evidence_binding"
                ? [{ id: "no-invoice-1" }]
                : []
            )
        },
        invoiceExceptionConfirmation: {
          findMany: jest.fn().mockResolvedValue([])
        },
        $queryRaw: jest
          .fn()
          .mockResolvedValue(
            conflict === "other_business_binding"
              ? [{ fileId: "invoice-evidence-file" }]
              : []
          )
      };

      await expect(
        (
          service as unknown as {
            assertCanDownloadFileObject(
              client: unknown,
              file: { id: string },
              actorUserId: string
            ): Promise<void>;
          }
        ).assertCanDownloadFileObject(
          tx,
          { id: "invoice-evidence-file" },
          "invoice-viewer"
        )
      ).rejects.toThrow("资料文件存在跨业务绑定冲突，暂不能下载");
    }
  );

  it("fails closed outside test when file download secret is missing", () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      secret: process.env.FILE_DOWNLOAD_SECRET
    };
    process.env.NODE_ENV = "development";
    delete process.env.FILE_DOWNLOAD_SECRET;

    try {
      expect(
        () =>
          new FileService(
            {} as PrismaService,
            audit as unknown as AuditService,
            storage as unknown as PrivateFileStorage
          )
      ).toThrow("FILE_DOWNLOAD_SECRET");
    } finally {
      process.env.NODE_ENV = previous.nodeEnv;
      if (previous.secret === undefined) delete process.env.FILE_DOWNLOAD_SECRET;
      else process.env.FILE_DOWNLOAD_SECRET = previous.secret;
    }
  });

  it("rejects private storage object keys outside the configured root", async () => {
    const previousRoot = process.env.FILE_STORAGE_ROOT;
    process.env.FILE_STORAGE_ROOT = "/private/tmp/private-root";

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.read("../private-root-evil/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
    } finally {
      if (previousRoot === undefined) {
        delete process.env.FILE_STORAGE_ROOT;
      } else {
        process.env.FILE_STORAGE_ROOT = previousRoot;
      }
    }
  });

  it("deletes local private files and treats a missing object as success", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = join(temporaryRoot, "private");

    try {
      const privateStorage = new PrivateFileStorage();
      expect(() => privateStorage.onModuleInit()).not.toThrow();
      await privateStorage.write("uploads/file.pdf", Buffer.from("private-file"));
      await expect(privateStorage.read("uploads/file.pdf")).resolves.toEqual(
        Buffer.from("private-file")
      );

      await privateStorage.write("uploads/file.pdf", Buffer.from("updated-private-file"));
      await expect(privateStorage.read("uploads/file.pdf")).resolves.toEqual(
        Buffer.from("updated-private-file")
      );

      await expect(privateStorage.delete("uploads/file.pdf")).resolves.toBeUndefined();
      await expect(readFile(join(temporaryRoot, "private/uploads/file.pdf"))).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(privateStorage.delete("uploads/file.pdf")).resolves.toBeUndefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects a local read through an intermediate symlink outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideRoot = join(temporaryRoot, "outside");
    const outsideFile = join(outsideRoot, "file.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideRoot, join(privateRoot, "uploads"), "dir");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.read("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects reading a target symlink that points outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads"), { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideFile, join(privateRoot, "uploads/file.pdf"), "file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.read("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects a local write through an intermediate symlink without creating outside files", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideRoot = join(temporaryRoot, "outside");
    const outsideTarget = join(outsideRoot, "nested/file.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, join(privateRoot, "uploads"), "dir");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(
        privateStorage.write("uploads/nested/file.pdf", Buffer.from("private-file"))
      ).rejects.toThrow("私有文件路径无效，系统已阻止本次文件读取。");
      await expect(readFile(outsideTarget)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects writing a target symlink without modifying its outside target", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads"), { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideFile, join(privateRoot, "uploads/file.pdf"), "file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(
        privateStorage.write("uploads/file.pdf", Buffer.from("private-file"))
      ).rejects.toThrow("私有文件路径无效，系统已阻止本次文件读取。");
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("uses fixed messages for missing reads and local filesystem write failures", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads/folder.pdf"), { recursive: true });

    try {
      const privateStorage = new PrivateFileStorage();
      const readError = await privateStorage.read("uploads/missing.pdf").catch((reason) => reason);
      const writeError = await privateStorage
        .write("uploads/folder.pdf", Buffer.from("private-file"))
        .catch((reason) => reason);

      expect(readError).toEqual(expect.objectContaining({ message: "本地文件读取失败" }));
      expect(writeError).toEqual(expect.objectContaining({ message: "本地文件写入失败" }));
      expect(String((readError as { message?: unknown }).message)).not.toContain(temporaryRoot);
      expect(String((writeError as { message?: unknown }).message)).not.toContain(temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects an unsafe COS delete key before making a network request", async () => {
    const previous = snapshotStorageEnv();
    process.env.FILE_STORAGE_DRIVER = "cos";
    const fetchMock = jest.spyOn(globalThis, "fetch");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("../outside.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("rejects an out-of-root delete without touching the outside file", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = join(temporaryRoot, "private");
    await writeFile(outsideFile, "outside-file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("../outside.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects a local delete through an intermediate symlink outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideRoot = join(temporaryRoot, "outside");
    const outsideFile = join(outsideRoot, "file.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideRoot, join(privateRoot, "uploads"), "dir");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects deleting a target symlink that points outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads"), { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideFile, join(privateRoot, "uploads/file.pdf"), "file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("hides local paths when canonical path validation fails", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await symlink("loop-b", join(privateRoot, "loop-a"));
    await symlink("loop-a", join(privateRoot, "loop-b"));

    try {
      const privateStorage = new PrivateFileStorage();
      const error = await privateStorage.delete("loop-a/file.pdf").catch((reason) => reason);

      expect(error).toEqual(
        expect.objectContaining({ message: "本地文件存储路径校验失败" })
      );
      expect(String((error as { message?: unknown }).message)).not.toContain(temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("hides local paths when deleting an existing directory fails", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads/folder"), { recursive: true });

    try {
      const privateStorage = new PrivateFileStorage();
      const error = await privateStorage.delete("uploads/folder").catch((reason) => reason);

      expect(error).toEqual(expect.objectContaining({ message: "本地文件删除失败" }));
      expect(String((error as { message?: unknown }).message)).not.toContain(temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it.each([204, 299, 404])(
    "deletes a private COS object idempotently when COS returns %s",
    async (status) => {
      const previous = snapshotStorageEnv();
      configureCosStorage();
      const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: async () => new ArrayBuffer(0)
      } as Response);
      const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

      try {
        const privateStorage = new PrivateFileStorage();

        await expect(privateStorage.delete("uploads/合同.pdf")).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledWith(
          "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
          expect.objectContaining({
            method: "DELETE",
            headers: expect.objectContaining({
              Host: "private-bucket.cos.ap-guangzhou.myqcloud.com",
              Authorization:
                "q-sign-algorithm=sha1&q-ak=secret-id&q-sign-time=1700000000;1700000600" +
                "&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=" +
                "&q-signature=02badb510ed63c81d6977c447ee4631fdf0a2e00"
            })
          })
        );
      } finally {
        dateNowMock.mockRestore();
        fetchMock.mockRestore();
        restoreStorageEnv(previous);
      }
    }
  );

  it("uses a safe business message when COS delete fails", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);

    try {
      const privateStorage = new PrivateFileStorage();
      const action = privateStorage.delete("uploads/file.pdf");

      await expect(action).rejects.toThrow("私有文件从对象存储删除失败，请稍后重试或联系管理员");
      await expect(action).rejects.not.toThrow("secret-key");
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it.each(["COS_BUCKET", "COS_REGION", "COS_SECRET_ID", "COS_SECRET_KEY"] as const)(
    "fails storage startup when %s is missing without exposing configured values",
    (missingKey) => {
      const previous = snapshotStorageEnv();
      configureCosStorage();
      process.env.COS_SECRET_ID = "configured-secret-id";
      process.env.COS_SECRET_KEY = "configured-secret-key";
      process.env.COS_BUCKET = "configured-private-bucket";
      delete process.env[missingKey];

      try {
        const privateStorage = new PrivateFileStorage();
        expect(() => privateStorage.onModuleInit()).toThrow(missingKey);
        let errorMessage = "";
        try {
          privateStorage.assertConfigured();
        } catch (error) {
          errorMessage = String(error);
        }
        expect(errorMessage).toContain(missingKey);
        expect(errorMessage).not.toContain("configured-secret-id");
        expect(errorMessage).not.toContain("configured-secret-key");
        expect(errorMessage).not.toContain("configured-private-bucket");
      } finally {
        restoreStorageEnv(previous);
      }
    }
  );

  it("validates complete COS configuration at startup without contacting COS", () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch");

    try {
      const privateStorage = new PrivateFileStorage();

      expect(() => privateStorage.onModuleInit()).not.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it.each(["", "   ", "/", "."])(
    "rejects an unsafe local storage root %j without touching the filesystem",
    (root) => {
      const previous = snapshotStorageEnv();
      process.env.FILE_STORAGE_DRIVER = "local";
      process.env.FILE_STORAGE_ROOT = root;

      try {
        const privateStorage = new PrivateFileStorage();

        expect(() => privateStorage.onModuleInit()).toThrow("FILE_STORAGE_ROOT");
      } finally {
        restoreStorageEnv(previous);
      }
    }
  );

  it("accepts the default local storage root without creating it during startup", () => {
    const previous = snapshotStorageEnv();
    process.env.FILE_STORAGE_DRIVER = "local";
    delete process.env.FILE_STORAGE_ROOT;

    try {
      const privateStorage = new PrivateFileStorage();

      expect(() => privateStorage.onModuleInit()).not.toThrow();
    } finally {
      restoreStorageEnv(previous);
    }
  });

  it("stores and reads private files from COS when enabled", async () => {
    const previous = {
      driver: process.env.FILE_STORAGE_DRIVER,
      secretId: process.env.COS_SECRET_ID,
      secretKey: process.env.COS_SECRET_KEY,
      bucket: process.env.COS_BUCKET,
      region: process.env.COS_REGION
    };
    process.env.FILE_STORAGE_DRIVER = "cos";
    process.env.COS_SECRET_ID = "secret-id";
    process.env.COS_SECRET_KEY = "secret-key";
    process.env.COS_BUCKET = "private-bucket";
    process.env.COS_REGION = "ap-guangzhou";
    const responseBody = Uint8Array.from(Buffer.from("cos-file"));
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => responseBody.buffer
    } as Response);
    const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    try {
      const privateStorage = new PrivateFileStorage();

      await privateStorage.write("uploads/合同.pdf", Buffer.from("private-file"));
      const buffer = await privateStorage.read("uploads/合同.pdf");

      expect(privateStorage.bucketName()).toBe("private-bucket");
      expect(buffer).toEqual(Buffer.from("cos-file"));
      expect(fetchMock).toHaveBeenCalledWith(
        "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Host: "private-bucket.cos.ap-guangzhou.myqcloud.com",
            Authorization: expect.stringContaining("q-ak=secret-id")
          }),
          body: new Uint8Array(Buffer.from("private-file"))
        })
      );
      expect(fetchMock).toHaveBeenLastCalledWith(
        "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization:
              "q-sign-algorithm=sha1&q-ak=secret-id&q-sign-time=1700000000;1700000600" +
              "&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=" +
              "&q-signature=a69c3d8d01bd4da652ef8cb81548968625404997"
          })
        })
      );
    } finally {
      dateNowMock.mockRestore();
      fetchMock.mockRestore();
      if (previous.driver === undefined) delete process.env.FILE_STORAGE_DRIVER;
      else process.env.FILE_STORAGE_DRIVER = previous.driver;
      if (previous.secretId === undefined) delete process.env.COS_SECRET_ID;
      else process.env.COS_SECRET_ID = previous.secretId;
      if (previous.secretKey === undefined) delete process.env.COS_SECRET_KEY;
      else process.env.COS_SECRET_KEY = previous.secretKey;
      if (previous.bucket === undefined) delete process.env.COS_BUCKET;
      else process.env.COS_BUCKET = previous.bucket;
      if (previous.region === undefined) delete process.env.COS_REGION;
      else process.env.COS_REGION = previous.region;
    }
  });

  it("signs the raw Chinese COS path while requesting its encoded URL", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);
    const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    try {
      const privateStorage = new PrivateFileStorage();

      await privateStorage.write("uploads/合同.pdf", Buffer.from("private-file"));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization:
              "q-sign-algorithm=sha1&q-ak=secret-id&q-sign-time=1700000000;1700000600" +
              "&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=" +
              "&q-signature=b539aea8053cb66374f9dae1a857588422bf97af"
          })
        })
      );
    } finally {
      dateNowMock.mockRestore();
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("logs sanitized COS diagnostics without exposing credentials or file names", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const objectKey = "uploads/历史接管合同.pdf";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          "<Error>",
          "<Code>SignatureDoesNotMatch</Code>",
          "<Message>敏感上游错误细节</Message>",
          "<RequestId>NjY4OGQ1YjRfMTIzNDU2Nw==</RequestId>",
          "</Error>"
        ].join(""),
        { status: 403 }
      )
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    try {
      const privateStorage = new PrivateFileStorage();
      const action = privateStorage.write(objectKey, Buffer.from("private-file"));

      await expect(action).rejects.toThrow(
        "私有文件上传到对象存储失败，请稍后重试或联系管理员"
      );
      expect(loggerError).toHaveBeenCalledWith({
        event: "private_file_cos_request_failed",
        operation: "上传",
        statusCode: 403,
        cosErrorCode: "SignatureDoesNotMatch",
        cosRequestId: "NjY4OGQ1YjRfMTIzNDU2Nw==",
        objectKeyFingerprint: createHash("sha256").update(objectKey).digest("hex").slice(0, 16)
      });

      const loggedOutput = JSON.stringify(loggerError.mock.calls);
      expect(loggedOutput).not.toContain(objectKey);
      expect(loggedOutput).not.toContain("secret-id");
      expect(loggedOutput).not.toContain("secret-key");
      expect(loggedOutput).not.toContain("敏感上游错误细节");
    } finally {
      loggerError.mockRestore();
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("keeps COS transport failures observable without logging the upstream error", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const objectKey = "uploads/历史接管合同.pdf";
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error(`socket failure: secret-key ${objectKey}`));
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    try {
      const privateStorage = new PrivateFileStorage();
      const action = privateStorage.read(objectKey);

      await expect(action).rejects.toThrow(
        "资料文件暂时无法从对象存储读取，请稍后重试或联系管理员"
      );
      expect(loggerError).toHaveBeenCalledWith({
        event: "private_file_cos_request_failed",
        operation: "读取",
        failureType: "传输失败",
        objectKeyFingerprint: createHash("sha256").update(objectKey).digest("hex").slice(0, 16)
      });

      const loggedOutput = JSON.stringify(loggerError.mock.calls);
      expect(loggedOutput).not.toContain(objectKey);
      expect(loggedOutput).not.toContain("secret-key");
      expect(loggedOutput).not.toContain("socket failure");
    } finally {
      loggerError.mockRestore();
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it.each([
    ["PUT", "私有文件上传到对象存储失败，请稍后重试或联系管理员"],
    ["GET", "资料文件暂时无法从对象存储读取，请稍后重试或联系管理员"]
  ] as const)("uses a business message when COS %s fails", async (method, message) => {
    const previous = {
      driver: process.env.FILE_STORAGE_DRIVER,
      secretId: process.env.COS_SECRET_ID,
      secretKey: process.env.COS_SECRET_KEY,
      bucket: process.env.COS_BUCKET,
      region: process.env.COS_REGION
    };
    process.env.FILE_STORAGE_DRIVER = "cos";
    process.env.COS_SECRET_ID = "secret-id";
    process.env.COS_SECRET_KEY = "secret-key";
    process.env.COS_BUCKET = "private-bucket";
    process.env.COS_REGION = "ap-guangzhou";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);

    try {
      const privateStorage = new PrivateFileStorage();
      const action =
        method === "PUT"
          ? privateStorage.write("uploads/合同.pdf", Buffer.from("private-file"))
          : privateStorage.read("uploads/合同.pdf");

      await expect(action).rejects.toThrow(message);
    } finally {
      fetchMock.mockRestore();
      if (previous.driver === undefined) delete process.env.FILE_STORAGE_DRIVER;
      else process.env.FILE_STORAGE_DRIVER = previous.driver;
      if (previous.secretId === undefined) delete process.env.COS_SECRET_ID;
      else process.env.COS_SECRET_ID = previous.secretId;
      if (previous.secretKey === undefined) delete process.env.COS_SECRET_KEY;
      else process.env.COS_SECRET_KEY = previous.secretKey;
      if (previous.bucket === undefined) delete process.env.COS_BUCKET;
      else process.env.COS_BUCKET = previous.bucket;
      if (previous.region === undefined) delete process.env.COS_REGION;
      else process.env.COS_REGION = previous.region;
    }
  });

  it.each([
    ["PUT", "私有文件上传到对象存储失败，请稍后重试或联系管理员"],
    ["GET", "资料文件暂时无法从对象存储读取，请稍后重试或联系管理员"]
  ] as const)("does not treat a COS %s 404 as success", async (method, message) => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);

    try {
      const privateStorage = new PrivateFileStorage();
      const action =
        method === "PUT"
          ? privateStorage.write("uploads/file.pdf", Buffer.from("private-file"))
          : privateStorage.read("uploads/file.pdf");

      await expect(action).rejects.toThrow(message);
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("stores a private upload and records a file object with audit log", async () => {
    const buffer = Buffer.from("private-file");
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "private/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = await service.uploadPrivateFile({
      originalName: "盖章合同.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer
    });

    expect(result.id).toBe("file-1");
    expect(storage.write).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\/[a-f0-9-]+-盖章合同\.pdf$/),
      buffer
    );
    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bucket: "private-local",
        objectKey: expect.stringMatching(/^uploads\/[a-f0-9-]+-盖章合同\.pdf$/),
        originalName: "盖章合同.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        contentSha256,
        storageStatus: "active",
        supersedesFileObjectId: null
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-staff-1",
      action: "file.upload",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        bucket: "private-local",
        objectKey: "private/file-1.pdf",
        originalName: "盖章合同.pdf",
        sizeBytes: 12
      }
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("returns an exact idempotent upload replay before touching storage", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const buffer = Buffer.from("private-file");
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const existing = {
      id: idempotencyKey,
      bucket: "private-local",
      objectKey: `uploads/idempotent/${idempotencyKey}/existing-object.pdf`,
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      contentSha256,
      storageStatus: "active",
      supersedesFileObjectId: null,
      createdAt: new Date()
    };
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(existing)
      },
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer,
        idempotencyKey
      })
    ).resolves.toBe(existing);

    expect(storage.write).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("uses the upload idempotency key as the file id and a unique content-bound object key", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const buffer = Buffer.from("private-file");
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const tx = {
      fileObject: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            createdAt: new Date()
          })
        )
      }
    };
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = await service.uploadPrivateFile({
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer,
      idempotencyKey
    });

    expect(result.id).toBe(idempotencyKey);
    const objectKey = storage.write.mock.calls[0]?.[0] as string;
    expect(objectKey).toMatch(
      new RegExp(
        `^uploads/idempotent/${idempotencyKey}/[a-f0-9-]+-${contentSha256}-合同附件\\.pdf$`,
        "u"
      )
    );
    expect(storage.write).toHaveBeenCalledWith(objectKey, buffer);
    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: idempotencyKey,
        contentSha256
      })
    });
  });

  it("rejects a malformed upload idempotency key before touching storage", async () => {
    const prisma = {
      fileObject: { findUnique: jest.fn() },
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("private-file"),
        idempotencyKey: "not-a-uuid"
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storage.write).not.toHaveBeenCalled();
    expect(prisma.fileObject.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reuse of an upload idempotency key for different content", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: idempotencyKey,
          bucket: "private-local",
          objectKey: `uploads/idempotent/${idempotencyKey}-winner-合同附件.pdf`,
          originalName: "合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 6,
          uploadedByUserId: "contract-staff-1",
          contentSha256: createHash("sha256")
            .update(Buffer.from("winner"))
            .digest("hex"),
          storageStatus: "active",
          supersedesFileObjectId: null,
          createdAt: new Date()
        })
      },
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("private-file"),
        idempotencyKey
      })
    ).rejects.toBeInstanceOf(ConflictException);

    expect(storage.write).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("replays the committed winner after a concurrent idempotent upload conflict", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const buffer = Buffer.from("private-file");
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const winner = {
      id: idempotencyKey,
      bucket: "private-local",
      objectKey: `uploads/idempotent/${idempotencyKey}/winner.pdf`,
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      contentSha256,
      storageStatus: "active",
      supersedesFileObjectId: null,
      createdAt: new Date()
    };
    const conflict = Object.assign(new Error("unique conflict"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002"
    });
    const prisma = {
      fileObject: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner)
      },
      $transaction: jest.fn().mockRejectedValue(conflict)
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer,
        idempotencyKey
      })
    ).resolves.toBe(winner);

    const losingObjectKey = storage.write.mock.calls[0]?.[0] as string;
    expect(losingObjectKey).not.toBe(winner.objectKey);
    expect(storage.delete).toHaveBeenCalledWith(losingObjectKey);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("deletes only its unique losing object after a concurrent idempotency conflict", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const buffer = Buffer.from("private-file");
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const winner = {
      id: idempotencyKey,
      bucket: "private-local",
      objectKey: `uploads/idempotent/${idempotencyKey}/winner.pdf`,
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "another-contract-staff",
      contentSha256,
      storageStatus: "active",
      supersedesFileObjectId: null,
      createdAt: new Date()
    };
    const conflict = Object.assign(new Error("unique conflict"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002"
    });
    const prisma = {
      fileObject: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner)
      },
      $transaction: jest.fn().mockRejectedValue(conflict)
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer,
        idempotencyKey
      })
    ).rejects.toBeInstanceOf(ConflictException);

    const losingObjectKey = storage.write.mock.calls[0]?.[0] as string;
    expect(losingObjectKey).not.toBe(winner.objectKey);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(losingObjectKey);
    expect(storage.delete).not.toHaveBeenCalledWith(winner.objectKey);
  });

  it("keeps another in-flight upload object when one same-key transaction fails before registration", async () => {
    const deferred = <T,>() => {
      let resolve!: (value: T | PromiseLike<T>) => void;
      const promise = new Promise<T>((next) => {
        resolve = next;
      });
      return { promise, resolve };
    };
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const buffer = Buffer.from("private-file");
    const firstEntered = deferred<void>();
    const secondEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const releaseSecond = deferred<void>();
    const firstFailure = new Error("transaction connection failed");
    let transactionCall = 0;
    const tx = {
      fileObject: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            createdAt: new Date()
          })
        )
      }
    };
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => {
          transactionCall += 1;
          if (transactionCall === 1) {
            firstEntered.resolve();
            await releaseFirst.promise;
            throw firstFailure;
          }
          secondEntered.resolve();
          await releaseSecond.promise;
          return callback(tx);
        }
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const input = {
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer,
      idempotencyKey
    };

    const first = service.uploadPrivateFile(input);
    const firstFailureExpectation = expect(first).rejects.toBe(firstFailure);
    await firstEntered.promise;
    const second = service.uploadPrivateFile(input);
    await secondEntered.promise;
    const firstObjectKey = storage.write.mock.calls[0]?.[0] as string;
    const secondObjectKey = storage.write.mock.calls[1]?.[0] as string;
    expect(firstObjectKey).not.toBe(secondObjectKey);

    releaseFirst.resolve();
    await firstFailureExpectation;
    expect(storage.delete).toHaveBeenCalledWith(firstObjectKey);
    expect(storage.delete).not.toHaveBeenCalledWith(secondObjectKey);

    releaseSecond.resolve();
    await expect(second).resolves.toMatchObject({
      id: idempotencyKey,
      objectKey: secondObjectKey
    });
    expect(storage.delete).not.toHaveBeenCalledWith(secondObjectKey);
  });

  it("returns its own idempotent upload after transaction acknowledgement loss", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    let persisted: Record<string, unknown> | null = null;
    const tx = {
      fileObject: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => {
            persisted = { ...data, createdAt: new Date() };
            return persisted;
          }
        )
      }
    };
    const prisma = {
      fileObject: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockImplementation(async () => persisted)
      },
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => {
          await callback(tx);
          throw new Error("transaction acknowledgement lost");
        }
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = await service.uploadPrivateFile({
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer: Buffer.from("private-file"),
      idempotencyKey
    });

    expect(result).toBe(persisted);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("does not delete an idempotent object when commit acknowledgement is lost before the row becomes visible", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const acknowledgementError = new Error(
      "transaction acknowledgement lost before visibility"
    );
    const tx = {
      fileObject: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            createdAt: new Date()
          })
        )
      }
    };
    const prisma = {
      fileObject: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
      },
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => {
          await callback(tx);
          throw acknowledgementError;
        }
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("private-file"),
        idempotencyKey
      })
    ).rejects.toThrow("文件登记结果暂时无法确认");

    const attemptedObjectKey = storage.write.mock.calls[0]?.[0] as string;
    expect(attemptedObjectKey).toContain(
      `uploads/idempotent/${idempotencyKey}/`
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("审批单生成文件在登记事务中同时 CAS 绑定持久 claim", async () => {
    const tx = {
      fileObject: { create: jest.fn().mockResolvedValue({
        id: "file-claim-1",
        bucket: "private-local",
        objectKey: "uploads/file-claim-1.pdf",
        originalName: "合同审批单.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "user-1"
      }) },
      approvalFormGenerationClaim: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
      fileObject: { findUnique: jest.fn().mockResolvedValue(null) }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await service.uploadPrivateFile({
      originalName: "合同审批单.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "user-1",
      buffer: Buffer.from("private-file"),
      approvalFormGenerationClaim: {
        approvalInstanceId: "instance-1",
        claimToken: "claim-token-1"
      }
    });

    expect(tx.approvalFormGenerationClaim.updateMany).toHaveBeenCalledWith({
      where: {
        approvalInstanceId: "instance-1",
        claimToken: "claim-token-1",
        status: "pending",
        uploadedFileId: null
      },
      data: {
        status: "uploaded",
        uploadedFileId: "file-claim-1",
        safeFailureCode: null
      }
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("returns a committed ordinary upload when the transaction acknowledgement is lost", async () => {
    const acknowledgementError = new Error("transaction acknowledgement lost");
    let persisted: Record<string, unknown> | null = null;
    const tx = {
      fileObject: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          persisted = { ...data, createdAt: new Date() };
          return persisted;
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => {
        await callback(tx);
        throw acknowledgementError;
      }),
      fileObject: { findUnique: jest.fn(async () => persisted) }
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = await service.uploadPrivateFile({
      originalName: "合同附件.pdf", mimeType: "application/pdf", sizeBytes: 12,
      uploadedByUserId: "contract-staff-1", buffer: Buffer.from("private-file")
    });

    expect(result.id).toBe((tx.fileObject.create.mock.calls[0]?.[0].data as { id: string }).id);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("returns a committed settlement-claim upload only when the claim points to its preallocated id", async () => {
    const acknowledgementError = new Error("transaction acknowledgement lost");
    let persisted: Record<string, unknown> | null = null;
    let uploadedFileId: string | null = null;
    const claim = {
      updateMany: jest.fn(async (args: { data: { uploadedFileId: string } }) => {
        uploadedFileId = args.data.uploadedFileId;
        return { count: 1 };
      }),
      findFirst: jest.fn(async ({ where }: { where: { uploadedFileId: string } }) =>
        where.uploadedFileId === uploadedFileId ? { settlementId: "settlement-1" } : null
      )
    };
    const tx = {
      fileObject: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          persisted = { ...data, createdAt: new Date() };
          return persisted;
        })
      },
      settlementSignedDocumentGenerationClaim: claim
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => {
        await callback(tx);
        throw acknowledgementError;
      }),
      fileObject: { findUnique: jest.fn(async () => persisted) },
      settlementSignedDocumentGenerationClaim: claim
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = await service.uploadPrivateFile({
      originalName: "结算签名合成件.pdf", mimeType: "application/pdf", sizeBytes: 12,
      uploadedByUserId: "contract-director-1", buffer: Buffer.from("private-file"),
      settlementSignedDocumentGenerationClaim: {
        settlementId: "settlement-1", claimToken: "123e4567-e89b-42d3-a456-426614174000"
      }
    });

    expect(result.id).toBe(uploadedFileId);
    expect(claim.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ uploadedFileId })
    }));
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("does not delete storage when commit verification itself fails after the transaction callback completed", async () => {
    const transactionError = new Error("transaction acknowledgement lost");
    const tx = {
      fileObject: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            createdAt: new Date()
          })
        )
      }
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => {
          await callback(tx);
          throw transactionError;
        }
      ),
      fileObject: { findUnique: jest.fn().mockRejectedValue(new Error("database unavailable")) }
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.uploadPrivateFile({
      originalName: "合同附件.pdf", mimeType: "application/pdf", sizeBytes: 12,
      uploadedByUserId: "contract-staff-1", buffer: Buffer.from("private-file")
    })).rejects.toThrow("文件登记结果暂时无法确认");

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("cleans its unique object when an idempotent transaction fails before callback completion and winner verification is unavailable", async () => {
    const idempotencyKey = "a43073f9-9731-4d71-9498-b9727344dbd4";
    const transactionError = new Error("transaction unavailable");
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(transactionError),
      fileObject: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockRejectedValueOnce(new Error("winner verification unavailable"))
      }
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("private-file"),
        idempotencyKey
      })
    ).rejects.toThrow("文件登记结果暂时无法确认");

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(
      storage.write.mock.calls[0]?.[0]
    );
  });

  it("claim CAS 丢失时回滚文件登记并清理已写入 COS，不留孤儿", async () => {
    const tx = {
      fileObject: { create: jest.fn().mockResolvedValue({
        id: "file-loser",
        bucket: "private-local",
        objectKey: "uploads/file-loser.pdf",
        originalName: "合同审批单.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "user-1"
      }) },
      approvalFormGenerationClaim: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
      fileObject: { findUnique: jest.fn().mockResolvedValue(null) }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.uploadPrivateFile({
      originalName: "合同审批单.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "user-1",
      buffer: Buffer.from("private-file"),
      approvalFormGenerationClaim: {
        approvalInstanceId: "instance-1",
        claimToken: "lost-token"
      }
    })).rejects.toThrow("审批单生成权已变化");

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(expect.stringMatching(/^uploads\//u));
  });

  it.each(["file object creation", "upload audit"] as const)(
    "deletes the written object once and rethrows the original transaction error when %s fails",
    async (failureStage) => {
      const transactionError = Object.assign(new Error(`transaction failed at ${failureStage}`), {
        name: "PrismaClientKnownRequestError",
        code: "P2002"
      });
      const tx = {
        fileObject: {
          create: jest.fn()
        }
      };
      if (failureStage === "file object creation") {
        tx.fileObject.create.mockRejectedValue(transactionError as never);
        audit.record.mockResolvedValue(undefined);
      } else {
        tx.fileObject.create.mockResolvedValue({
          id: "file-transaction-failure",
          bucket: "private-local",
          objectKey: "uploads/file-transaction-failure.pdf",
          originalName: "合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        } as never);
        audit.record.mockRejectedValue(transactionError);
      }
      const prisma = {
        $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx)
        ),
        fileObject: { findUnique: jest.fn().mockResolvedValue(null) }
      } as unknown as PrismaService;
      const service = new FileService(
        prisma,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );

      let thrown: unknown;
      try {
        await service.uploadPrivateFile({
          originalName: "合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("private-file")
        });
      } catch (error) {
        thrown = error;
      }

      const objectKey = storage.write.mock.calls[0]?.[0] as string;
      expect(objectKey).toMatch(/^uploads\/[a-f0-9-]+-合同附件\.pdf$/);
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(objectKey);
      expect(thrown).toBe(transactionError);
      expect((thrown as Error).name).toBe("PrismaClientKnownRequestError");
      expect((thrown as Error & { code: string }).code).toBe("P2002");
    }
  );

  it("logs only safe failure facts and returns a fixed 500 when orphan cleanup also fails", async () => {
    const transactionError = Object.assign(
      new Error("database failed Authorization=Bearer db-secret"),
      {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
        secret: "db-secret",
        buffer: Buffer.from("db-buffer-secret")
      }
    );
    const cleanupError = Object.assign(
      new Error("COS delete failed Authorization=Bearer cos-secret"),
      {
        name: "CosDeleteError",
        code: "COS_DELETE_FAILED",
        Authorization: "Bearer cos-secret",
        buffer: Buffer.from("cos-buffer-secret")
      }
    );
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(transactionError),
      fileObject: { findUnique: jest.fn().mockResolvedValue(null) }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.delete.mockRejectedValue(cleanupError);

    try {
      let thrown: unknown;
      try {
        await service.uploadPrivateFile({
          originalName: "敏感合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("private-file")
        });
      } catch (error) {
        thrown = error;
      }

      const objectKey = storage.write.mock.calls[0]?.[0] as string;
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(objectKey);
      expect(loggerError).toHaveBeenCalledTimes(1);

      const logged = JSON.stringify(loggerError.mock.calls);
      expect(logged).toContain(
        createHash("sha256").update(objectKey).digest("hex").slice(0, 16)
      );
      expect(logged).not.toContain(objectKey);
      expect(logged).not.toContain("敏感合同附件.pdf");
      expect(logged).toContain("database_transaction");
      expect(logged).toContain("orphan_cleanup");
      expect(logged).toContain("PrismaClientKnownRequestError");
      expect(logged).toContain("P2002");
      expect(logged).toContain("CosDeleteError");
      expect(logged).toContain("COS_DELETE_FAILED");
      expect(logged).not.toContain("db-secret");
      expect(logged).not.toContain("cos-secret");
      expect(logged).not.toContain("db-buffer-secret");
      expect(logged).not.toContain("cos-buffer-secret");
      expect(logged).not.toContain("Authorization");

      expect(thrown).toBeInstanceOf(InternalServerErrorException);
      expect((thrown as InternalServerErrorException).getStatus()).toBe(500);
      expect((thrown as InternalServerErrorException).message).toBe(
        "文件登记失败且存储清理未完成"
      );
      const publicFailure = JSON.stringify(thrown);
      expect(publicFailure).not.toContain(objectKey);
      expect(publicFailure).not.toContain("db-secret");
      expect(publicFailure).not.toContain("cos-secret");
      expect(publicFailure).not.toContain("敏感合同附件.pdf");
    } finally {
      loggerError.mockRestore();
    }
  });

  it("deletes its unique attempted object when the storage write response fails", async () => {
    const storageError = new Error("storage write failed");
    storage.write.mockRejectedValue(storageError);
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("private-file")
      })
    ).rejects.toBe(storageError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(
      storage.write.mock.calls[0]?.[0]
    );
  });

  it("returns a fixed error and logs only safe facts when storage-write compensation cannot be confirmed", async () => {
    const storageError = Object.assign(
      new Error("COS PUT lost Authorization=Bearer put-secret"),
      {
        name: "CosPutError",
        code: "COS_PUT_FAILED",
        secret: "put-secret"
      }
    );
    const cleanupError = Object.assign(
      new Error("COS DELETE lost Authorization=Bearer delete-secret"),
      {
        name: "CosDeleteError",
        code: "COS_DELETE_FAILED",
        secret: "delete-secret"
      }
    );
    storage.write.mockRejectedValue(storageError);
    storage.delete.mockRejectedValue(cleanupError);
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation();

    const thrown = await service
      .uploadPrivateFile({
        originalName: "敏感合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("private-file")
      })
      .catch((error) => error);

    const objectKey = storage.write.mock.calls[0]?.[0] as string;
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(objectKey);
    expect(loggerError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(loggerError.mock.calls);
    expect(logged).toContain("storage_write");
    expect(logged).toContain("orphan_cleanup");
    expect(logged).toContain("CosPutError");
    expect(logged).toContain("COS_PUT_FAILED");
    expect(logged).toContain("CosDeleteError");
    expect(logged).toContain("COS_DELETE_FAILED");
    expect(logged).not.toContain(objectKey);
    expect(logged).not.toContain("敏感合同附件.pdf");
    expect(logged).not.toContain("put-secret");
    expect(logged).not.toContain("delete-secret");
    expect(logged).not.toContain("Authorization");
    expect(thrown).toBeInstanceOf(InternalServerErrorException);
    expect((thrown as InternalServerErrorException).message).toBe(
      "文件登记失败且存储清理未完成"
    );
  });

  it("does not delete a shared settlement-generation key when its storage write response fails", async () => {
    const storageError = new Error("storage write failed");
    const claimToken = "123e4567-e89b-42d3-a456-426614174000";
    storage.write.mockRejectedValue(storageError);
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "结算签名合成件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-director-1",
        buffer: Buffer.from("private-file"),
        settlementSignedDocumentGenerationClaim: {
          settlementId: "settlement-1",
          claimToken
        }
      })
    ).rejects.toBe(storageError);

    expect(storage.write).toHaveBeenCalledWith(
      `uploads/settlement-signed-generation/${claimToken}.pdf`,
      Buffer.from("private-file")
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("ignores a forged replacement pointer during upload so linking only happens through the replacement helper", async () => {
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-new",
          bucket: "private-local",
          objectKey: "uploads/new-file.pdf",
          originalName: "合同更正件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1",
          supersedesFileObjectId: null
        }),
        update: jest.fn(),
        delete: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const input = {
      originalName: "合同更正件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer: Buffer.from("private-file"),
      supersedesFileObjectId: "file-old"
    };

    await service.uploadPrivateFile(input);

    const objectKey = storage.write.mock.calls[0]?.[0] as string;
    expect(objectKey).toMatch(/^uploads\/[a-f0-9-]+-合同更正件\.pdf$/);
    expect(objectKey).not.toBe("uploads/file-old.pdf");
    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        objectKey,
        supersedesFileObjectId: null
      })
    });
    expect(tx.fileObject.update).not.toHaveBeenCalled();
    expect(tx.fileObject.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  function replacementFile(
    id: string,
    overrides: Partial<{
      uploadedByUserId: string;
      storageStatus: string;
      supersedesFileObjectId: string | null;
    }> = {}
  ) {
    return {
      id,
      uploadedByUserId: "contract-staff-1",
      storageStatus: "active",
      supersedesFileObjectId: null,
      ...overrides
    };
  }

  function replacementTransaction(
    rows: ReadonlyArray<ReturnType<typeof replacementFile>>,
    options: {
      casCount?: number;
      rereadSupersedesFileObjectId?: string | null;
      unlockedRows?: ReadonlyArray<ReturnType<typeof replacementFile>>;
      events?: string[];
    } = {}
  ) {
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const queryRaw = jest.fn(async (query: { values?: unknown[] }) => {
      const text = (
        query as { strings?: readonly string[] }
      ).strings?.join("?") ?? "";
      if (text.includes("pg_advisory_xact_lock")) {
        return [{ pg_advisory_xact_lock: null }];
      }
      options.events?.push("lock");
      return (query.values ?? [])
        .filter((value): value is string => typeof value === "string")
        .map((id) => rowsById.get(id))
        .filter((row): row is ReturnType<typeof replacementFile> => Boolean(row));
    });
    const updateMany = jest.fn(async () => {
      options.events?.push("update");
      return { count: options.casCount ?? 1 };
    });

    return {
      $queryRaw: queryRaw,
      fileObject: {
        findMany: jest.fn().mockResolvedValue(options.unlockedRows ?? rows),
        updateMany,
        findUnique: jest.fn().mockResolvedValue({
          supersedesFileObjectId: options.rereadSupersedesFileObjectId ?? null
        }),
        delete: jest.fn()
      }
    };
  }

  it("rejects linking a file replacement to itself without touching storage", async () => {
    const tx = replacementTransaction([]);
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = service.linkFileReplacement(tx as never, {
      newFileId: "file-same",
      oldFileId: "file-same",
      actorUserId: "contract-staff-1"
    });
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow("新旧文件不能为同一文件");

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("does not remap an unexpected database failure while locking replacement files", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new"),
      replacementFile("file-old")
    ]);
    const databaseError = new Error("database connection lost");
    tx.$queryRaw
      .mockResolvedValueOnce([{ pg_advisory_xact_lock: null }])
      .mockRejectedValueOnce(databaseError);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toBe(databaseError);

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["new file", [replacementFile("file-old")]],
    ["old file", [replacementFile("file-new")]]
  ] as const)("rejects linking when the %s is missing", async (_label, files) => {
    const tx = replacementTransaction(files);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("新文件或被替换文件不存在");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it.each(["file-new", "file-old"])(
    "rejects linking when %s is not active",
    async (inactiveFileId) => {
      const tx = replacementTransaction([
        replacementFile("file-new", {
          storageStatus: inactiveFileId === "file-new" ? "quarantined" : "active"
        }),
        replacementFile("file-old", {
          storageStatus: inactiveFileId === "file-old" ? "quarantined" : "active"
        })
      ]);
      const service = new FileService({} as PrismaService, audit as never, storage as never);

      await expect(
        service.linkFileReplacement(tx as never, {
          newFileId: "file-new",
          oldFileId: "file-old",
          actorUserId: "contract-staff-1"
        })
      ).rejects.toThrow("新旧文件必须处于可用状态");

      expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    }
  );

  it("rejects linking when the actor did not upload the new file", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new", { uploadedByUserId: "another-user" }),
      replacementFile("file-old")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    const result = service.linkFileReplacement(tx as never, {
      newFileId: "file-new",
      oldFileId: "file-old",
      actorUserId: "contract-staff-1"
    });
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toThrow("当前账号无权接入该文件替换链");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("links an unlinked new file with a conditional CAS update and preserves the old file", async () => {
    const events: string[] = [];
    const tx = replacementTransaction(
      [replacementFile("file-z-new"), replacementFile("file-a-old")],
      { events }
    );
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-z-new",
        oldFileId: "file-a-old",
        actorUserId: "contract-staff-1"
      })
    ).resolves.toBeUndefined();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const advisoryLockQuery = tx.$queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
    };
    expect(advisoryLockQuery.strings.join("?")).toContain(
      "pg_advisory_xact_lock"
    );
    const initialLockQuery = tx.$queryRaw.mock.calls[1]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(initialLockQuery.values).toEqual(["file-a-old", "file-z-new"]);
    expect(initialLockQuery.strings.join("?")).toContain("FOR UPDATE");
    expect(initialLockQuery.strings.join("?")).toContain('FROM "FileObject"');
    expect(initialLockQuery.strings.join("?")).not.toContain("file-a-old");
    expect(initialLockQuery.strings.join("?")).not.toContain("file-z-new");
    expect(tx.fileObject.findMany).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).toHaveBeenCalledWith({
      where: {
        id: "file-z-new",
        uploadedByUserId: "contract-staff-1",
        storageStatus: "active",
        supersedesFileObjectId: null
      },
      data: { supersedesFileObjectId: "file-a-old" }
    });
    expect(events).toEqual(["lock", "update"]);
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.fileObject.delete).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("treats an existing link to the same old file as idempotent", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new", { supersedesFileObjectId: "file-old" }),
      replacementFile("file-old")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).resolves.toBeUndefined();

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an existing link to a different old file", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new", { supersedesFileObjectId: "file-other" }),
      replacementFile("file-old")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("新文件已关联其他被替换文件");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a direct A-B replacement cycle after locking both rows", async () => {
    const tx = replacementTransaction([
      replacementFile("file-a"),
      replacementFile("file-b", { supersedesFileObjectId: "file-a" })
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-a",
        oldFileId: "file-b",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects closing an A-B-C replacement chain back to A", async () => {
    const tx = replacementTransaction([
      replacementFile("file-a", { supersedesFileObjectId: "file-b" }),
      replacementFile("file-b", { supersedesFileObjectId: "file-c" }),
      replacementFile("file-c")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-c",
        oldFileId: "file-a",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an already corrupted repeating replacement chain", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new"),
      replacementFile("file-a", { supersedesFileObjectId: "file-b" }),
      replacementFile("file-b", { supersedesFileObjectId: "file-a" })
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-a",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("uses the locked snapshot when an unlocked old row appeared active", async () => {
    const tx = replacementTransaction(
      [replacementFile("file-new"), replacementFile("file-old", { storageStatus: "deleted" })],
      {
        unlockedRows: [replacementFile("file-new"), replacementFile("file-old")]
      }
    );
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("新旧文件必须处于可用状态");

    expect(tx.fileObject.findMany).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects the reverse concurrent link after sorted locks reveal the first committed link", async () => {
    const tx = replacementTransaction([
      replacementFile("file-a", { supersedesFileObjectId: "file-b" }),
      replacementFile("file-b")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-b",
        oldFileId: "file-a",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    const lockQuery = tx.$queryRaw.mock.calls[1]?.[0] as { values: unknown[] };
    expect(lockQuery.values).toEqual(["file-a", "file-b"]);
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("treats a lost CAS as concurrent idempotency when reread links the same old file", async () => {
    const tx = replacementTransaction(
      [replacementFile("file-new"), replacementFile("file-old")],
      { casCount: 0, rereadSupersedesFileObjectId: "file-old" }
    );
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).resolves.toBeUndefined();

    expect(tx.fileObject.findUnique).toHaveBeenCalledWith({
      where: { id: "file-new" },
      select: { supersedesFileObjectId: true }
    });
  });

  it.each(["file-other", null])(
    "rejects a lost CAS when reread replacement is %s",
    async (supersedesFileObjectId) => {
      const tx = replacementTransaction(
        [replacementFile("file-new"), replacementFile("file-old")],
        { casCount: 0, rereadSupersedesFileObjectId: supersedesFileObjectId }
      );
      const service = new FileService({} as PrismaService, audit as never, storage as never);

      await expect(
        service.linkFileReplacement(tx as never, {
          newFileId: "file-new",
          oldFileId: "file-old",
          actorUserId: "contract-staff-1"
        })
      ).rejects.toThrow("新文件已关联其他被替换文件");
    }
  );

  it("loads a private file buffer for an authorized internal service", async () => {
    const buffer = Buffer.from("docx");
    const file = {
      id: "file-docx",
      objectKey: "uploads/template.docx",
      storageStatus: "active",
      contentSha256: createHash("sha256").update(buffer).digest("hex")
    };
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(file)
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(buffer);

    const result = await service.getFileBuffer("file-docx");

    expect(result.file.id).toBe("file-docx");
    expect(result.buffer.equals(Buffer.from("docx"))).toBe(true);
  });

  it("reads an active owned receipt source only when hash and size both match", async () => {
    const buffer = Buffer.from("receipt-photo");
    const file = {
      id: "receipt-source",
      objectKey: "uploads/receipt-source.jpg",
      uploadedByUserId: "handler-1",
      storageStatus: "active",
      sizeBytes: buffer.length,
      contentSha256: createHash("sha256").update(buffer).digest("hex")
    };
    const prisma = {
      fileObject: { findUnique: jest.fn().mockResolvedValue(file) }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(buffer);

    await expect(
      service.getOwnedVerifiedFileBuffer("receipt-source", "handler-1")
    ).resolves.toEqual({ file, buffer });
  });

  it("rejects a receipt source uploaded by another user before storage read", async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "receipt-source",
          uploadedByUserId: "other-user",
          storageStatus: "active",
          contentSha256: "a".repeat(64),
          sizeBytes: 1
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.getOwnedVerifiedFileBuffer("receipt-source", "handler-1")
    ).rejects.toThrow("当前账号无权使用该收货原始文件");
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("rejects an inactive owned receipt source before storage read", async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "receipt-source",
          uploadedByUserId: "handler-1",
          storageStatus: "quarantined",
          contentSha256: "a".repeat(64),
          sizeBytes: 1
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.getOwnedVerifiedFileBuffer("receipt-source", "handler-1")
    ).rejects.toThrow("资料文件当前不可用");
    expect(storage.read).not.toHaveBeenCalled();
  });

  it.each([null, "invalid-hash"])(
    "rejects a receipt source with invalid integrity metadata %s before storage read",
    async (contentSha256) => {
      const prisma = {
        fileObject: {
          findUnique: jest.fn().mockResolvedValue({
            id: "receipt-source",
            objectKey: "uploads/receipt-source.jpg",
            uploadedByUserId: "handler-1",
            storageStatus: "active",
            contentSha256,
            sizeBytes: 1
          })
        }
      } as unknown as PrismaService;
      const service = new FileService(
        prisma,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );
      const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();

      try {
        await expect(
          service.getOwnedVerifiedFileBuffer("receipt-source", "handler-1")
        ).rejects.toThrow("资料文件完整性校验失败");
        expect(storage.read).not.toHaveBeenCalled();
      } finally {
        loggerError.mockRestore();
      }
    }
  );

  it("rejects a receipt source whose registered size differs from private storage", async () => {
    const buffer = Buffer.from("receipt-photo");
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "receipt-source",
          objectKey: "uploads/receipt-source.jpg",
          uploadedByUserId: "handler-1",
          storageStatus: "active",
          contentSha256: createHash("sha256").update(buffer).digest("hex"),
          sizeBytes: buffer.length + 1
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.read.mockResolvedValue(buffer);

    try {
      await expect(
        service.getOwnedVerifiedFileBuffer("receipt-source", "handler-1")
      ).rejects.toThrow("资料文件完整性校验失败");
    } finally {
      loggerError.mockRestore();
    }
  });

  it("locks and returns an active file only when no business record binds it", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { pg_advisory_xact_lock: null }
        ])
        .mockResolvedValueOnce([
          {
            id: "unbound-file",
            uploadedByUserId: "finance-staff",
            storageStatus: "active"
          }
        ])
        .mockResolvedValueOnce([]),
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertFileHasNoBusinessBinding(
        tx as never,
        "unbound-file"
      )
    ).resolves.toEqual({
      id: "unbound-file",
      uploadedByUserId: "finance-staff",
      storageStatus: "active"
    });
    expect(
      (tx.$queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join(" ")
    ).toContain("pg_advisory_xact_lock");
    expect(
      (tx.$queryRaw.mock.calls[1][0] as { strings: string[] }).strings.join(" ")
    ).toContain("FOR UPDATE");
  });

  it.each(["receipt_photo", "other_business"])(
    "rejects a file already bound by %s after taking the file lock",
    async (bindingType) => {
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([
            { pg_advisory_xact_lock: null }
          ])
          .mockResolvedValueOnce([
            {
              id: "bound-file",
              uploadedByUserId: "finance-staff",
              storageStatus: "active"
            }
          ])
          .mockResolvedValueOnce(
            bindingType === "other_business"
              ? [{ fileId: "bound-file" }]
              : []
          ),
        spotProcurementReceiptPhoto: {
          findFirst: jest.fn().mockResolvedValue(
            bindingType === "receipt_photo" ? { id: "photo-1" } : null
          )
        }
      };
      const service = new FileService(
        {} as PrismaService,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );

      await expect(
        service.assertFileHasNoBusinessBinding(
          tx as never,
          "bound-file"
        )
      ).rejects.toThrow(
        "该文件已绑定其他业务记录，不能重复使用"
      );
    }
  );

  it("locks draft attachment files and allows only the current owner with no other binding", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ pg_advisory_xact_lock: null }])
        .mockResolvedValueOnce([
          {
            id: "draft-attachment-1",
            mimeType: "application/pdf",
            uploadedByUserId: "owner-1",
            storageStatus: "active"
          }
        ])
        .mockResolvedValueOnce([]),
      contractDraftAttachment: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertCanBindContractDraftAttachments(
        tx as never,
        "contract-version-1",
        ["draft-attachment-1"],
        "owner-1"
      )
    ).resolves.toBeUndefined();
    expect(
      (tx.$queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join(" ")
    ).toContain("pg_advisory_xact_lock");
    expect(
      (tx.$queryRaw.mock.calls[1][0] as { strings: string[] }).strings.join(" ")
    ).toContain("FOR UPDATE");
  });

  it.each(["other_draft", "other_business"])(
    "rejects a draft attachment already bound by %s",
    async (bindingType) => {
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ pg_advisory_xact_lock: null }])
          .mockResolvedValueOnce([
            {
              id: "draft-attachment-1",
              mimeType: "application/pdf",
              uploadedByUserId: "owner-1",
              storageStatus: "active"
            }
          ])
          .mockResolvedValueOnce(
            bindingType === "other_business"
              ? [{ fileId: "draft-attachment-1" }]
              : []
          ),
        contractDraftAttachment: {
          findFirst: jest.fn().mockResolvedValue(
            bindingType === "other_draft" ? { id: "other-draft-link" } : null
          )
        },
        spotProcurementReceiptPhoto: {
          findFirst: jest.fn().mockResolvedValue(null)
        }
      };
      const service = new FileService(
        {} as PrismaService,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );

      await expect(
        service.assertCanBindContractDraftAttachments(
          tx as never,
          "contract-version-1",
          ["draft-attachment-1"],
          "owner-1"
        )
      ).rejects.toThrow("该文件已绑定其他业务记录，不能重复使用");
    }
  );

  it("rejects a missing file before checking business bindings", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { pg_advisory_xact_lock: null }
        ])
        .mockResolvedValueOnce([]),
      spotProcurementReceiptPhoto: { findFirst: jest.fn() }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertFileHasNoBusinessBinding(tx as never, "missing-file")
    ).rejects.toThrow("文件不存在或已被移除");
    expect(tx.spotProcurementReceiptPhoto.findFirst).not.toHaveBeenCalled();
  });

  it("quarantines an owned active watermark only when no receipt photo binds it", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { pg_advisory_xact_lock: null }
        ])
        .mockResolvedValueOnce([
          {
            id: "watermark-file",
            uploadedByUserId: "handler-1",
            storageStatus: "active"
          }
        ])
        .mockResolvedValueOnce([]),
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      fileObject: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.quarantineUnboundReceiptWatermark("watermark-file", "handler-1")
    ).resolves.toBe(true);
    expect(tx.fileObject.updateMany).toHaveBeenCalledWith({
      where: {
        id: "watermark-file",
        uploadedByUserId: "handler-1",
        storageStatus: "active"
      },
      data: { storageStatus: "quarantined" }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "file.quarantine.unbound_receipt_watermark",
        businessId: "watermark-file"
      })
    );
  });

  it("never quarantines a generated receipt file that another business already bound", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { pg_advisory_xact_lock: null }
        ])
        .mockResolvedValueOnce([
          {
            id: "generated-file",
            uploadedByUserId: "handler-1",
            storageStatus: "active"
          }
        ])
        .mockResolvedValueOnce([
          { fileId: "generated-file" }
        ]),
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      fileObject: {
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => unknown) =>
          callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.quarantineUnboundReceiptWatermark(
        "generated-file",
        "handler-1"
      )
    ).resolves.toBe(false);
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("preserves a generated file when either receipt photo column already binds it", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { pg_advisory_xact_lock: null }
        ])
        .mockResolvedValueOnce([
          {
            id: "watermark-file",
            uploadedByUserId: "handler-1",
            storageStatus: "active"
          }
        ])
        .mockResolvedValueOnce([]),
      spotProcurementReceiptPhoto: {
        findFirst: jest.fn().mockResolvedValue({ id: "photo-1" })
      },
      fileObject: {
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.quarantineUnboundReceiptWatermark("watermark-file", "handler-1")
    ).resolves.toBe(false);
    expect(
      tx.spotProcurementReceiptPhoto.findFirst
    ).toHaveBeenCalledWith({
      where: {
        OR: [
          { originalFileId: "watermark-file" },
          { watermarkedFileId: "watermark-file" }
        ]
      },
      select: { id: true }
    });
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("never quarantines another user's unbound file", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { pg_advisory_xact_lock: null }
        ])
        .mockResolvedValueOnce([
          {
            id: "watermark-file",
            uploadedByUserId: "other-user",
            storageStatus: "active"
          }
        ]),
      spotProcurementReceiptPhoto: { findFirst: jest.fn() },
      fileObject: { updateMany: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.quarantineUnboundReceiptWatermark("watermark-file", "handler-1")
    ).resolves.toBe(false);
    expect(tx.spotProcurementReceiptPhoto.findFirst).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a historical internal file without a content hash readable without download audit", async () => {
    const file = {
      id: "file-legacy-docx",
      objectKey: "uploads/legacy-template.docx",
      storageStatus: "active",
      contentSha256: null
    };
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(file)
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(Buffer.from("legacy-docx"));

    await expect(service.getFileBuffer("file-legacy-docx")).resolves.toEqual({
      file,
      buffer: Buffer.from("legacy-docx")
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects an inactive file before an internal storage read", async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-inactive",
          objectKey: "uploads/inactive.docx",
          storageStatus: "quarantined",
          contentSha256: null
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.getFileBuffer("file-inactive")).rejects.toThrow(
      "资料文件当前不可用，请联系管理员核对文件状态"
    );
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", "not-a-valid-hash", Buffer.from("private-file")],
    ["mismatched", "0".repeat(64), Buffer.from("tampered-file")]
  ])("rejects an internal file with a %s content hash", async (_caseName, contentSha256, buffer) => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-invalid-hash",
          objectKey: "uploads/invalid.docx",
          storageStatus: "active",
          contentSha256
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.read.mockResolvedValue(buffer);

    try {
      await expect(service.getFileBuffer("file-invalid-hash")).rejects.toThrow(
        "资料文件完整性校验失败，请联系管理员核对存储文件"
      );
      expect(loggerError).toHaveBeenCalledWith(
        "私有文件完整性校验失败 fileId=file-invalid-hash"
      );
      expect(JSON.stringify(loggerError.mock.calls)).not.toContain(contentSha256);
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
  });

  it("uses a fixed message when an internal storage read fails", async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-storage-error",
          objectKey: "uploads/storage-error.docx",
          storageStatus: "active",
          contentSha256: null
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockRejectedValue(new Error("ENOENT /private/secret/path"));

    await expect(service.getFileBuffer("file-storage-error")).rejects.toThrow(
      "资料文件暂时无法读取，请稍后重试或联系管理员核对私有存储"
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("authorizes and returns file metadata with the caller transaction", async () => {
    const file = {
      id: "file-1",
      uploadedByUserId: "owner-1"
    };
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(file)
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertCanDownloadFile(tx as never, "file-1", "owner-1")
    ).resolves.toBe(file);
    expect(tx.fileObject.findUnique).toHaveBeenCalledWith({ where: { id: "file-1" } });
  });

  it("rejects private uploads without an uploader in business Chinese", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "盖章合同.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: " ",
        buffer: Buffer.from("private-file")
      })
    ).rejects.toThrow("上传人信息缺失，请重新登录后再上传资料");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("rejects empty private uploads in business Chinese", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "盖章合同.pdf",
        mimeType: "application/pdf",
        sizeBytes: 0,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.alloc(0)
      })
    ).rejects.toThrow("上传文件为空，请重新选择资料文件");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("rejects files over FILE_UPLOAD_MAX_BYTES", async () => {
    const previous = process.env.FILE_UPLOAD_MAX_BYTES;
    process.env.FILE_UPLOAD_MAX_BYTES = "4";
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    try {
      await expect(
        service.uploadPrivateFile({
          originalName: "template.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: 5,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("12345")
        })
      ).rejects.toThrow("上传文件超过系统限制，请压缩后重新上传或联系管理员");
      expect(storage.write).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.FILE_UPLOAD_MAX_BYTES;
      else process.env.FILE_UPLOAD_MAX_BYTES = previous;
    }
  });

  it("rejects extensions outside controlled Word Excel PDF and image types", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "template.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("text")
      })
    ).rejects.toThrow("文件格式不支持，请上传 PDF、Word、Excel 或图片资料");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it.each([
    ["旧版报价.doc", "application/msword"],
    ["旧版清单.xls", "application/vnd.ms-excel"]
  ])(
    "accepts the controlled legacy Office file %s",
    async (originalName, mimeType) => {
      const tx = {
        fileObject: {
          create: jest.fn().mockResolvedValue({
            id: "file-legacy",
            bucket: "private-local",
            objectKey: `uploads/${originalName}`,
            originalName,
            mimeType,
            sizeBytes: 12,
            uploadedByUserId: "material-1"
          })
        }
      };
      const prisma = {
        $transaction: jest.fn(
          async (callback: (transaction: typeof tx) => unknown) =>
            callback(tx)
        )
      } as unknown as PrismaService;
      const service = new FileService(
        prisma,
        audit as never,
        storage as never
      );

      await expect(
        service.uploadPrivateFile({
          originalName,
          mimeType,
          sizeBytes: 12,
          uploadedByUserId: "material-1",
          buffer: Buffer.from("legacy-file")
        })
      ).resolves.toMatchObject({ id: "file-legacy" });
    }
  );

  it("rejects DOCM and XLSM macro files", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    for (const originalName of ["template.docm", "bill.xlsm"]) {
      await expect(
        service.uploadPrivateFile({
          originalName,
          mimeType: "application/octet-stream",
          sizeBytes: 4,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("data")
        })
      ).rejects.toThrow("文件格式不支持，请上传 PDF、Word、Excel 或图片资料");
    }
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("does not inspect magic bytes or run virus scanning", async () => {
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.docx",
          originalName: "template.docx",
          mimeType: "application/octet-stream",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(prisma, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "template.docx",
        mimeType: "application/octet-stream",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("not-a-real-docx")
      })
    ).resolves.toMatchObject({ id: "file-1" });
    expect(storage.write).toHaveBeenCalledTimes(1);
  });

  it("records the configured storage bucket for private uploads", async () => {
    storage.bucketName.mockReturnValue("private-cos-bucket");
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-cos-bucket",
          objectKey: "uploads/file-1.pdf",
          originalName: "archive.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await service.uploadPrivateFile({
      originalName: "archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer: Buffer.from("private-file")
    });

    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bucket: "private-cos-bucket"
      })
    });
  });

  it("creates a short-lived download ticket for a private file", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "合同归档复核"
    });

    expect(ticket.fileId).toBe("file-1");
    expect(ticket.downloadUrl).toContain("/files/file-1/download?");
    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(ticket.downloadUrl).toContain(
      `downloadReason=${encodeURIComponent("合同归档复核")}`
    );
    expect(ticket.expiresAt).toMatch(/T/);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "合同归档复核"
      }
    });
  });

  it("allows the generation requester to download their own generated contract document via a short-lived ticket", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "generated-docx",
          bucket: "private-local",
          objectKey: "uploads/generated-docx.pdf",
          originalName: "HT-20260806-007-外发合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "owner-1"
        })
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      approvalFormGenerationClaim: { findFirst: jest.fn().mockResolvedValue(null) },
      projectOwnerContract: { findFirst: jest.fn().mockResolvedValue(null) },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("generated-docx", {
      actorUserId: "owner-1",
      downloadReason: "外发合同核对"
    });

    expect(ticket.downloadUrl).toContain("/files/generated-docx/download?");
    expect(ticket.downloadUrl).toContain("actorUserId=owner-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "owner-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "generated-docx",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "外发合同核对"
      }
    });
  });

  it("publishes a download-ticket capability only after the same file ACL check", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.getDownloadTicketCapability("file-1", "finance-1")
    ).resolves.toEqual({
      availableActions: ["create_private_file_download_ticket"],
      action: {
        key: "create_private_file_download_ticket",
        enabled: true
      }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("authorizes an offline-revision preview by the current contract owner, not the former uploader", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "preview-pdf",
          bucket: "private-local",
          objectKey: "uploads/preview-pdf.pdf",
          originalName: "线下修订预览.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "former-owner"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      contractOfflineRevision: {
        findFirst: jest.fn().mockResolvedValue({ contractVersionId: "version-1" })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          ownerUserId: "current-owner",
          voidedAt: null
        })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("preview-pdf", {
        actorUserId: "current-owner",
        downloadReason: "复核本轮合同差异"
      })
    ).resolves.toMatchObject({ fileId: "preview-pdf" });
    await expect(
      service.createDownloadTicket("preview-pdf", {
        actorUserId: "former-owner",
        downloadReason: "复核本轮合同差异"
      })
    ).rejects.toThrow("当前账号无权下载该线下修订稿文件");

    tx.fileObject.findUnique.mockResolvedValue({
      id: "offline-docx",
      bucket: "private-local",
      objectKey: "uploads/offline-docx.docx",
      originalName: "线下修订稿.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 24,
      uploadedByUserId: "former-owner"
    });
    await expect(
      service.createDownloadTicket("offline-docx", {
        actorUserId: "current-owner",
        downloadReason: "复核线下修订原文"
      })
    ).resolves.toMatchObject({ fileId: "offline-docx" });
    await expect(
      service.createDownloadTicket("offline-docx", {
        actorUserId: "former-owner",
        downloadReason: "复核线下修订原文"
      })
    ).rejects.toThrow("当前账号无权下载该线下修订稿文件");
    expect(tx.contractOfflineRevision.findFirst).toHaveBeenLastCalledWith({
      where: {
        OR: [{ fileId: "offline-docx" }, { previewPdfFileId: "offline-docx" }]
      },
      select: { contractVersionId: true }
    });
  });

  it("rejects download ticket creation when actor cannot access the file", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows project archive roles to create download tickets for takeover evidence", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "历史合同扫描件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      archiveRecord: {
        findFirst: jest.fn().mockResolvedValue({
          businessType: "contract_takeover",
          businessId: "takeover-1"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "复核历史接管资料"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.contractTakeover.findUnique).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "复核历史接管资料"
      }
    });
  });

  it("denies takeover evidence download tickets to users outside the project", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "历史合同扫描件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      archiveRecord: {
        findFirst: jest.fn().mockResolvedValue({
          businessType: "contract_takeover",
          businessId: "takeover-1"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "other-project-user-1",
        downloadReason: "复核历史接管资料"
      })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.contractTakeover.findUnique).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      select: { projectId: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    "contract_staff",
    "contract_director",
    "finance_staff",
    "finance_director",
    "comprehensive_director"
  ])("allows %s to use a short ticket for a project-visible takeover correction attachment", async (positionKey) => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "correction-file-1",
          bucket: "private-local",
          objectKey: "uploads/correction-file-1.pdf",
          originalName: "主体更正依据.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-user"
        })
      },
      contractTakeoverCorrection: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey }]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("correction-file-1", {
      actorUserId: `actor-${positionKey}`,
      downloadReason: "复核历史主体更正依据"
    });

    expect(tx.contractTakeoverCorrection.findFirst).toHaveBeenCalledWith({
      where: { attachmentFileId: "correction-file-1" },
      select: { projectId: true }
    });
    expect(ticket.expiresAt).toBeTruthy();
    expect(ticket.downloadUrl).toContain("correction-file-1");
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "file.download.ticket",
      businessId: "correction-file-1"
    }));
  });

  it("denies a takeover correction attachment even to its uploader without an approved project role", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "correction-file-1",
          bucket: "private-local",
          objectKey: "uploads/correction-file-1.pdf",
          originalName: "主体更正依据.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "unapproved-uploader"
        })
      },
      contractTakeoverCorrection: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "project_manager" }])
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.createDownloadTicket("correction-file-1", {
      actorUserId: "unapproved-uploader",
      downloadReason: "复核历史主体更正依据"
    })).rejects.toThrow("当前账号无权下载该历史接管更正依据");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each(["formal", "authorization"])(
    "does not let correction ACL override an invalidated governed contract %s file",
    async (kind) => {
      const invalidated = {
        status: "invalidated",
        contractVersionId: "contract-version-1",
        originContractVersionId: "contract-version-1"
      };
      const tx = {
        fileObject: {
          findUnique: jest.fn().mockResolvedValue({
            id: "conflicting-file",
            bucket: "private-local",
            objectKey: "uploads/conflicting-file.pdf",
            originalName: "已失效合同文件.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12,
            uploadedByUserId: "contract-user"
          })
        },
        contractFormalFile: {
          findFirst: jest.fn().mockResolvedValue(kind === "formal" ? invalidated : null)
        },
        contractAuthorization: {
          findFirst: jest.fn().mockResolvedValue(kind === "authorization" ? invalidated : null)
        },
        pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
        contractSealTask: { findFirst: jest.fn() },
        contractTakeoverCorrection: {
          findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" })
        },
        userPosition: { findMany: jest.fn().mockResolvedValue([]) },
        projectMember: {
          findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }])
        },
        auditLog: { create: jest.fn() }
      };
      const prisma = {
        $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx)
        )
      } as unknown as PrismaService;
      const service = new FileService(
        prisma,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );

      await expect(service.createDownloadTicket("conflicting-file", {
        actorUserId: "contract-director",
        downloadReason: "复核历史主体更正依据"
      })).rejects.toThrow("当前账号无权下载该合同签署资料");
      expect(tx.contractTakeoverCorrection.findFirst).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("allows finance users to create download tickets for linked contract archives", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          contractVersionId: "contract-version-1",
          fileId: "file-1",
          status: "confirmed"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects download tickets for pending contract archive files", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "待确认盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          contractVersionId: "contract-version-1",
          fileId: "file-1",
          status: "pending_confirm"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("资料尚未归档确认，暂不能下载");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects download tickets for pending settlement archive files", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "待确认签章结算单.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          settlementId: "settlement-1",
          fileId: "file-1",
          status: "pending_confirm"
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("资料尚未归档确认，暂不能下载");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows finance users to create download tickets for project receipt vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "收款凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: {
        findFirst: jest.fn().mockResolvedValue({
          id: "receipt-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows finance users to create download tickets for project proxy payment vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "总包代付凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "proxy-payment-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows budget users to create download tickets for upstream settlement vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "对上审定凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "budget-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "upstream-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "budget-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=budget-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "budget-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects finance users from downloading upstream settlement vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "对上审定凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "budget-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "upstream-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows project finance users to download upstream fund evidence", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "挂靠拨款依据.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamFundFact: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "上游资金依据复核"
      })
    ).resolves.toMatchObject({
      downloadUrl: expect.stringContaining("actorUserId=finance-1")
    });
    expect(tx.projectUpstreamFundFact.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { evidenceFileId: "file-1" },
          { confirmationSignatureFileId: "file-1" }
        ]
      },
      select: { projectId: true }
    });
  });

  it("rejects non-finance project roles from downloading upstream fund evidence", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "挂靠拨款依据.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamFundFact: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "budget-1",
        downloadReason: "上游资金依据复核"
      })
    ).rejects.toThrow("当前账号无权下载该上游资金资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not grant upstream settlement voucher access through voided records", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "作废对上审定凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "budget-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "budget-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.projectUpstreamSettlement.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { voucherFileId: "file-1" },
          { confirmationSignatureFileId: "file-1" }
        ],
        voidedAt: null
      },
      select: { projectId: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows approval roles to create download tickets for settlement exception quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "例外结算额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "exception-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "contract-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=contract-director-1");
    expect(tx.projectSettlementExceptionQuota.findFirst).toHaveBeenCalledWith({
      where: { attachmentFileId: "file-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects finance users from downloading settlement exception quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "例外结算额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "exception-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows financing approval roles to create download tickets for project financing quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "项目垫资额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: { findFirst: jest.fn().mockResolvedValue(null) },
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-director-1");
    expect(tx.projectFinancingQuota.findFirst).toHaveBeenCalledWith({
      where: { attachmentFileId: "file-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects finance staff from downloading project financing quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "项目垫资额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: { findFirst: jest.fn().mockResolvedValue(null) },
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-staff-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows project expense approvers to create download tickets for request attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "综合费用附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "employee-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          applicantUserId: "employee-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "budget-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=budget-director-1");
    expect(tx.projectExpenseRequest.findFirst).toHaveBeenCalledWith({
      where: { attachmentFileId: "file-1", voidedAt: null },
      select: { projectId: true, applicantUserId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "budget-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows finance users to create download tickets for project expense execution vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "综合费用实付凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "cashier-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseExecution: {
        findFirst: jest.fn().mockResolvedValue({
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.projectExpenseExecution.findFirst).toHaveBeenCalledWith({
      where: { voucherFileId: "file-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows archive-readable contract roles to download active project owner contract files", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "业主主合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectOwnerContract: {
        findFirst: jest.fn(({ where }: { where: { voidedAt?: null | { not: null } } }) =>
          Promise.resolve(
            where.voidedAt === null
              ? {
                  id: "owner-contract-1",
                  projectId: "project-1",
                  fileId: "file-1",
                  voidedAt: null
                }
              : {
                  id: "owner-contract-voided",
                  projectId: "project-1",
                  fileId: "file-1",
                  voidedAt: new Date("2026-07-01T00:00:00.000Z")
                }
          )
        )
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "contract-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=contract-director-1");
    expect(tx.projectOwnerContract.findFirst).toHaveBeenCalledWith({
      where: { fileId: "file-1", voidedAt: null },
      select: { projectId: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("does not grant project owner contract file access through voided records", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "作废业主主合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectOwnerContract: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "owner-contract-voided" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "contract-director-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(1, {
      where: { fileId: "file-1", voidedAt: null },
      select: { projectId: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(2, {
      where: { fileId: "file-1", voidedAt: { not: null } },
      select: { id: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects uploader download when the project owner contract file belongs to a voided record", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "作废业主主合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-uploader"
        })
      },
      projectOwnerContract: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "owner-contract-voided" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "contract-uploader", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(1, {
      where: { fileId: "file-1", voidedAt: null },
      select: { projectId: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(2, {
      where: { fileId: "file-1", voidedAt: { not: null } },
      select: { id: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows the applicant to download an approval-form PDF", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "审批单-PAY-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "payment_request",
          businessId: "pay-1",
          fileId: "file-1",
          templateKey: "approval_form"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "approved"
        })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "applicant-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=applicant-1");
  });

  it("allows finance staff to download a project expense approval-form PDF by project role", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "审批单-BX-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "chairman-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: "expense-1", projectId: "project-1" })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "project_expense_request",
          businessId: "expense-1",
          fileId: "file-1",
          templateKey: "approval_form"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "approved"
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.projectExpenseRequest.findUnique).toHaveBeenCalledWith({
      where: { id: "expense-1" }
    });
  });

  it("allows finance staff to download a project expense archived PDF by project role", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "报销归档-BX-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-director-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: "expense-1", projectId: "project-1" })
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      archiveRecord: {
        findFirst: jest.fn().mockResolvedValue({
          businessType: "project_expense_request",
          businessId: "expense-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.archiveRecord.findFirst).toHaveBeenCalledWith({
      where: { fileId: "file-1" },
      select: { businessType: true, businessId: true }
    });
  });

  it("allows the applicant to download the latest in-progress settlement approval PDF", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "applicant-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=applicant-1");
  });

  it("denies latest settlement approval PDF download to roles outside the frozen approval route", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          frozenNodes: [
            { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
            { name: "物资主管", mode: "any", roleKeys: ["material_director"] }
          ]
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({ id: "settlement-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "engineering_tech" }])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "engineering-user-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
  });

  it("allows latest settlement approval PDF download to roles in the frozen approval route", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          frozenNodes: [
            { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
            { name: "物资主管", mode: "any", roleKeys: ["material_director"] }
          ]
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({ id: "settlement-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "material_staff" }])
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "material-user-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=material-user-1");
  });

  it("does not treat non-signature approval logs as latest settlement approval PDF signatures", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn(async (args: { where?: { action?: unknown } }) =>
          args.where?.action ? null : { id: "remind-log-1", action: "remind" }
        )
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({ id: "settlement-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "engineering_tech" }])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "reminder-user-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.approvalActionLog.findFirst).toHaveBeenCalledWith({
      where: {
        approvalInstanceId: "inst-1",
        actorUserId: "reminder-user-1",
        action: { in: ["approve", "reject_previous", "return_to_applicant"] }
      }
    });
  });

  it("denies an unrelated user from downloading an approval-form PDF", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "审批单-PAY-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "payment_request",
          businessId: "pay-1",
          fileId: "file-1",
          templateKey: "approval_form"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "approved"
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: "pay-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "stranger-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
  });

  it("rejects overly long download reasons before creating a ticket", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "下载".repeat(101)
      })
    ).rejects.toThrow("下载原因不能超过 200 个字，请精简后重新提交");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects missing download reasons before creating a ticket", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "   "
      })
    ).rejects.toThrow("请填写下载原因，便于留痕审计");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("reads a private file through a short-lived ticket and records download audit", async () => {
    const buffer = Buffer.from("private-file");
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: createHash("sha256").update(buffer).digest("hex")
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(buffer);

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    audit.record.mockClear();

    const result = await service.readPrivateFile("file-1", {
      actorUserId: url.searchParams.get("actorUserId") ?? "",
      expiresAt: url.searchParams.get("expiresAt") ?? "",
      downloadReason: url.searchParams.get("downloadReason") ?? "",
      token: url.searchParams.get("token") ?? ""
    });

    expect(result.buffer).toEqual(buffer);
    expect(storage.read).toHaveBeenCalledWith("uploads/file-1.pdf");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        originalName: "盖章合同.pdf",
        sizeBytes: 12,
        downloadReason: "资料下载复核"
      }
    });

    const legacyExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const legacyToken = createHmac("sha256", "test-file-download-secret")
      .update(`file-1.finance-1.${legacyExpiresAt}.资料下载复核`)
      .digest("base64url");
    audit.record.mockClear();

    const legacyResult = await service.readPrivateFile("file-1", {
      actorUserId: "finance-1",
      expiresAt: legacyExpiresAt,
      downloadReason: "资料下载复核",
      token: legacyToken
    });

    expect(legacyResult.accessMode).toBe("download");
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "file.download"
    }));

    const previewTicket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "合同正式文件复核",
      accessMode: "preview"
    });
    const previewUrl = new URL(`http://local${previewTicket.downloadUrl}`);
    expect(previewUrl.searchParams.get("accessMode")).toBe("preview");
    audit.record.mockClear();

    const previewResult = await service.readPrivateFile("file-1", {
      actorUserId: previewUrl.searchParams.get("actorUserId") ?? "",
      expiresAt: previewUrl.searchParams.get("expiresAt") ?? "",
      downloadReason: previewUrl.searchParams.get("downloadReason") ?? "",
      accessMode: "preview",
      token: previewUrl.searchParams.get("token") ?? ""
    });

    expect(previewResult.accessMode).toBe("preview");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.preview",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        originalName: "盖章合同.pdf",
        sizeBytes: 12,
        downloadReason: "合同正式文件复核",
        accessMode: "preview"
      }
    });
  });

  it("rejects a private file whose stored content hash no longer matches", async () => {
    const expectedHash = "0".repeat(64);
    const actualHash = createHash("sha256").update("tampered-file").digest("hex");
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: expectedHash
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.read.mockResolvedValue(Buffer.from("tampered-file"));

    try {
      const ticket = await service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "资料下载复核"
      });
      const url = new URL(`http://local${ticket.downloadUrl}`);
      audit.record.mockClear();

      await expect(
        service.readPrivateFile("file-1", {
          actorUserId: url.searchParams.get("actorUserId") ?? "",
          expiresAt: url.searchParams.get("expiresAt") ?? "",
          downloadReason: url.searchParams.get("downloadReason") ?? "",
          token: url.searchParams.get("token") ?? ""
        })
      ).rejects.toThrow("资料文件完整性校验失败，请联系管理员核对存储文件");

      const logged = JSON.stringify(loggerError.mock.calls);
      expect(loggerError).toHaveBeenCalled();
      expect(logged).not.toContain(expectedHash);
      expect(logged).not.toContain(actualHash);
      expect(logged).not.toContain("uploads/file-1.pdf");
      expect(logged).not.toContain("secret-id");
      expect(logged).not.toContain("secret-key");
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
  });

  it.each([
    ["empty", ""],
    ["short", "abc"],
    ["uppercase", "A".repeat(64)],
    ["non-hex", "g".repeat(64)]
  ])("rejects a non-null malformed stored content hash: %s", async (_caseName, contentSha256) => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-malformed",
          bucket: "private-local",
          objectKey: "uploads/malformed.pdf",
          originalName: "合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.read.mockResolvedValue(Buffer.from("private-file"));

    try {
      const ticket = await service.createDownloadTicket("file-malformed", {
        actorUserId: "finance-1",
        downloadReason: "资料下载复核"
      });
      const url = new URL(`http://local${ticket.downloadUrl}`);
      audit.record.mockClear();

      await expect(
        service.readPrivateFile("file-malformed", {
          actorUserId: url.searchParams.get("actorUserId") ?? "",
          expiresAt: url.searchParams.get("expiresAt") ?? "",
          downloadReason: url.searchParams.get("downloadReason") ?? "",
          token: url.searchParams.get("token") ?? ""
        })
      ).rejects.toThrow("资料文件完整性校验失败，请联系管理员核对存储文件");

      expect(storage.read).toHaveBeenCalledWith("uploads/malformed.pdf");
      expect(loggerError).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith(
        "私有文件完整性校验失败 fileId=file-malformed"
      );
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
  });

  it("keeps historical files without a content hash readable", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-legacy",
          bucket: "private-local",
          objectKey: "uploads/legacy.pdf",
          originalName: "历史合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: null
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(Buffer.from("legacy-file"));

    const ticket = await service.createDownloadTicket("file-legacy", {
      actorUserId: "finance-1",
      downloadReason: "历史资料复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    const result = await service.readPrivateFile("file-legacy", {
      actorUserId: url.searchParams.get("actorUserId") ?? "",
      expiresAt: url.searchParams.get("expiresAt") ?? "",
      downloadReason: url.searchParams.get("downloadReason") ?? "",
      token: url.searchParams.get("token") ?? ""
    });

    expect(result.buffer).toEqual(Buffer.from("legacy-file"));
  });

  it("rejects an inactive ticket file before storage read or download success audit", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-inactive-ticket",
          bucket: "private-local",
          objectKey: "uploads/inactive.pdf",
          originalName: "停用资料.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "quarantined",
          contentSha256: null
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-inactive-ticket", {
      actorUserId: "finance-1",
      downloadReason: "停用资料复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    audit.record.mockClear();

    await expect(
      service.readPrivateFile("file-inactive-ticket", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("资料文件当前不可用，请联系管理员核对文件状态");
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects tampered download ticket fields before reading or auditing a ticket", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const transaction = jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    );
    const prisma = {
      $transaction: transaction
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    transaction.mockClear();
    audit.record.mockClear();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: "篡改下载原因",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: "篡改下载原因",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await expect(
      service.readPrivateFile("file-2", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: "other-user",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns a business message when private storage cannot read a ticket file", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: null
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockRejectedValueOnce(new Error("ENOENT: object missing"));

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    audit.record.mockClear();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("资料文件暂时无法读取，请稍后重试或联系管理员核对私有存储");
    expect(storage.read).toHaveBeenCalledWith("uploads/file-1.pdf");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects overly long download reasons before reading a ticket", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: "finance-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        token: "signed-ticket",
        downloadReason: "下载".repeat(101)
      })
    ).rejects.toThrow("下载原因不能超过 200 个字，请精简后重新提交");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

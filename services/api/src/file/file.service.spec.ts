import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService, PrivateFileStorage } from "./file.service";

describe("FileService", () => {
  const audit = {
    record: jest.fn()
  };
  const storage = {
    write: jest.fn(),
    read: jest.fn(),
    bucketName: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    storage.write.mockReset();
    storage.read.mockReset();
    storage.bucketName.mockReset();
    storage.bucketName.mockReturnValue("private-local");
  });

  it("rejects private storage object keys outside the configured root", async () => {
    const previousRoot = process.env.FILE_STORAGE_ROOT;
    process.env.FILE_STORAGE_ROOT = "/private/tmp/private-root";

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.read("../private-root-evil/file.pdf")).rejects.toThrow(
        "Invalid private file object key"
      );
    } finally {
      if (previousRoot === undefined) {
        delete process.env.FILE_STORAGE_ROOT;
      } else {
        process.env.FILE_STORAGE_ROOT = previousRoot;
      }
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
            Authorization: expect.stringContaining("q-sign-algorithm=sha1")
          })
        })
      );
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

  it("stores a private upload and records a file object with audit log", async () => {
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
      buffer: Buffer.from("private-file")
    });

    expect(result.id).toBe("file-1");
    expect(storage.write).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\/[a-f0-9-]+-盖章合同\.pdf$/),
      Buffer.from("private-file")
    );
    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bucket: "private-local",
        originalName: "盖章合同.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1"
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
      actorUserId: "finance-1"
    });

    expect(ticket.fileId).toBe("file-1");
    expect(ticket.downloadUrl).toContain("/files/file-1/download?");
    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(ticket.expiresAt).toMatch(/T/);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt
      }
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

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "finance-1"
      })
    ).rejects.toThrow("Actor cannot download private file");
    expect(audit.record).not.toHaveBeenCalled();
  });

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
          fileId: "file-1"
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
      actorUserId: "finance-1"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt
      }
    });
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
      actorUserId: "applicant-1"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=applicant-1");
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
      service.createDownloadTicket("file-1", { actorUserId: "stranger-1" })
    ).rejects.toThrow("Actor cannot download private file");
  });

  it("reads a private file through a short-lived ticket and records download audit", async () => {
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
    storage.read.mockResolvedValue(Buffer.from("private-file"));

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    audit.record.mockClear();

    const result = await service.readPrivateFile("file-1", {
      actorUserId: url.searchParams.get("actorUserId") ?? "",
      expiresAt: url.searchParams.get("expiresAt") ?? "",
      token: url.searchParams.get("token") ?? ""
    });

    expect(result.buffer).toEqual(Buffer.from("private-file"));
    expect(storage.read).toHaveBeenCalledWith("uploads/file-1.pdf");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        originalName: "盖章合同.pdf",
        sizeBytes: 12
      }
    });
  });
});

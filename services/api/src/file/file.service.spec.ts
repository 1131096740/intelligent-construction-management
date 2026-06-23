import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService, PrivateFileStorage } from "./file.service";

describe("FileService", () => {
  const audit = {
    record: jest.fn()
  };
  const storage = {
    write: jest.fn(),
    read: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    storage.write.mockReset();
    storage.read.mockReset();
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
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) }
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

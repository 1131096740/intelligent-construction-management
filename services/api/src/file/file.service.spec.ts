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

  it("loads a private file buffer for an authorized internal service", async () => {
    const file = {
      id: "file-docx",
      objectKey: "uploads/template.docx"
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
    storage.read.mockResolvedValue(Buffer.from("docx"));

    const result = await service.getFileBuffer("file-docx");

    expect(result.file.id).toBe("file-docx");
    expect(result.buffer.equals(Buffer.from("docx"))).toBe(true);
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
      ).rejects.toThrow("Private file exceeds upload size limit");
      expect(storage.write).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.FILE_UPLOAD_MAX_BYTES;
      else process.env.FILE_UPLOAD_MAX_BYTES = previous;
    }
  });

  it("rejects extensions outside DOCX XLSX PDF PNG JPEG", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "template.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("text")
      })
    ).rejects.toThrow("Private file extension is not allowed");
    expect(storage.write).not.toHaveBeenCalled();
  });

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
      ).rejects.toThrow("Private file extension is not allowed");
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
      actorUserId: "budget-1"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=budget-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "budget-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt
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
      service.createDownloadTicket("file-1", { actorUserId: "finance-1" })
    ).rejects.toThrow("Actor cannot download private file");
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
      service.createDownloadTicket("file-1", { actorUserId: "budget-1" })
    ).rejects.toThrow("Actor cannot download private file");
    expect(tx.projectUpstreamSettlement.findFirst).toHaveBeenCalledWith({
      where: { voucherFileId: "file-1", voidedAt: null },
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
      actorUserId: "contract-director-1"
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
        expiresAt: ticket.expiresAt
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
      service.createDownloadTicket("file-1", { actorUserId: "finance-1" })
    ).rejects.toThrow("Actor cannot download private file");
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
      actorUserId: "finance-director-1"
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
        expiresAt: ticket.expiresAt
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
      service.createDownloadTicket("file-1", { actorUserId: "finance-staff-1" })
    ).rejects.toThrow("Actor cannot download private file");
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
      actorUserId: "budget-director-1"
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
        expiresAt: ticket.expiresAt
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
      actorUserId: "finance-1"
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
        expiresAt: ticket.expiresAt
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
      actorUserId: "contract-director-1"
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
        expiresAt: ticket.expiresAt
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
      service.createDownloadTicket("file-1", { actorUserId: "contract-director-1" })
    ).rejects.toThrow("Actor cannot download private file");
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
      service.createDownloadTicket("file-1", { actorUserId: "contract-uploader" })
    ).rejects.toThrow("Actor cannot download private file");
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
      actorUserId: "applicant-1"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=applicant-1");
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
      actorUserId: "applicant-1"
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
      service.createDownloadTicket("file-1", { actorUserId: "engineering-user-1" })
    ).rejects.toThrow("Actor cannot download private file");
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
      actorUserId: "material-user-1"
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
      service.createDownloadTicket("file-1", { actorUserId: "reminder-user-1" })
    ).rejects.toThrow("Actor cannot download private file");
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

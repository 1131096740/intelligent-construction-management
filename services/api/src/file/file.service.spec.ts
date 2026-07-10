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
    process.env.NODE_ENV = "test";
    audit.record.mockReset();
    storage.write.mockReset();
    storage.read.mockReset();
    storage.bucketName.mockReset();
    storage.bucketName.mockReturnValue("private-local");
  });

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
    ).rejects.toThrow("文件格式不支持，请上传 PDF、Word、Excel 或图片资料");
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
        actorUserId: "finance-1",
        downloadReason: "资料下载复核"
      })
    ).rejects.toThrow("当前账号无权下载该资料");
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

    expect(result.buffer).toEqual(Buffer.from("private-file"));
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

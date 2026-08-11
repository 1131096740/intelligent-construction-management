import { PDFDocument } from "pdf-lib";
import { createHash, randomUUID } from "node:crypto";
import { ContractFormalFileService } from "./contract-formal-file.service";
import { convertDocxToPdf } from "../contract-document/libreoffice-converter";

jest.mock("../contract-document/libreoffice-converter", () => ({
  convertDocxToPdf: jest.fn()
}));

async function pdfBytes() {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return Buffer.from(await pdf.save());
}

function harness(overrides: Record<string, unknown> = {}) {
  const version = {
    id: "version-1",
    contractId: "contract-1",
    status: "draft",
    draftRevision: 3,
    documentContentRevision: 2,
    documentContentFingerprint: "d".repeat(64),
    contractGovernanceVersion: 1
  };
  const file: {
    id: string;
    uploadedByUserId: string;
    storageStatus: string;
    mimeType: string;
    sizeBytes: number;
    contentSha256: string | null;
  } = {
    id: "file-1",
    uploadedByUserId: "owner-1",
    storageStatus: "active",
    mimeType: "application/pdf",
    sizeBytes: 0,
    contentSha256: null
  };
  const formalFacts = {
    hasSignedFormalFile: false,
    hasActiveSealTask: false,
    hasArchiveFile: false,
    hasSettlement: false,
    hasPaymentRequest: false
  };
  const tx = {
    $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes("FOR UPDATE OF cv")) return [version];
      if (sql.includes("FOR UPDATE OF c")) {
        return [{ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }];
      }
      if (sql.includes('AS "hasSignedFormalFile"')) return [formalFacts];
      if (sql.includes('FROM "FileObject"')) return [file];
      return [];
    }),
    contractFormalFile: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockImplementation(({ data }) => ({ id: "formal-1", ...data }))
    },
    contractVersionAuthorizationLink: {
      findMany: jest.fn().mockResolvedValue([
        { side: "first_party", required: false, authorizationId: null },
        { side: "counterparty", required: false, authorizationId: null }
      ])
    },
    contractAuthorization: {
      findUnique: jest.fn(),
      findFirst: jest.fn()
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
  };
  const bytes = Buffer.alloc(0);
  const prisma = {
    $transaction: jest.fn((fn) => fn(tx)),
    auditLog: { create: jest.fn() },
    ...overrides
  };
  const files = {
    getFileBuffer: jest.fn().mockResolvedValue({ file, buffer: bytes })
  };
  return { version, file, formalFacts, tx, prisma, files };
}

describe("ContractFormalFileService", () => {
  it("关联当前修订的完整乙方签章审批 PDF，并使相同重试幂等", async () => {
    const bytes = await pdfBytes();
    const { file, tx, version, prisma, files } = harness();
    file.sizeBytes = bytes.length;
    file.contentSha256 = createHash("sha256").update(bytes).digest("hex");
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);
    const input = {
      fileId: file.id,
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    };

    await expect(service.uploadApprovalVersion("version-1", "owner-1", input)).resolves.toMatchObject({
      fileId: "file-1",
      sourceRevision: 3,
      pageCount: 1,
      status: "active"
    });
    const firstData = tx.contractFormalFile.create.mock.calls[0][0].data;
    expect(firstData).toMatchObject({
      purpose: "approval_original",
      declarationSnapshot: expect.objectContaining({
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      })
    });
    const created = { id: "formal-1", ...firstData };
    tx.contractFormalFile.findFirst.mockResolvedValue(created);
    await service.uploadApprovalVersion("version-1", "owner-1", input);
    expect(tx.contractFormalFile.create).toHaveBeenCalledTimes(1);
    version.draftRevision = 4;
    await expect(service.assertReadyForSubmission(tx as never, version as never))
      .resolves.toMatchObject({ id: "formal-1", sourceRevision: 3 });
  });

  it("过期修订在读取文件前即被拒绝", async () => {
    const bytes = await pdfBytes();
    const { file, prisma, files } = harness();
    file.sizeBytes = bytes.length;
    file.contentSha256 = "a".repeat(64);
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);
    await expect(service.uploadApprovalVersion("version-1", "owner-1", {
      fileId: file.id,
      sourceRevision: 2,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    })).rejects.toThrow();
    expect(files.getFileBuffer).not.toHaveBeenCalled();
  });

  it("draft 状态已有有效用印事实时禁止继续替换签前文件", async () => {
    const { formalFacts, tx, prisma, files } = harness();
    formalFacts.hasActiveSealTask = true;
    const service = new ContractFormalFileService(
      prisma as never,
      undefined,
      files as never
    );

    await expect(
      service.uploadApprovalVersion("version-1", "owner-1", {
        fileId: "file-1",
        sourceRevision: 3,
        counterpartySigned: true,
        counterpartyStamped: true,
        crossPageSealCompleted: true,
        documentOrderConfirmed: true,
        authorizationsBeforeSignaturePageConfirmed: true
      })
    ).rejects.toThrow("正式业务事实");
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
    expect(files.getFileBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ["other", "application/pdf", "active", "只能关联本人本次上传的合同文件"],
    ["owner-1", "image/png", "active", "合同正式文件必须为 PDF 格式"],
    ["owner-1", "application/pdf", "deleted", "所选合同文件不存在或当前不可用"]
  ])("rejects invalid FileObject owner/mime/status %#", async (
    uploadedByUserId,
    mimeType,
    storageStatus,
    message
  ) => {
    const bytes = await pdfBytes();
    const { file, prisma, files } = harness();
    file.uploadedByUserId = uploadedByUserId;
    file.mimeType = mimeType;
    file.storageStatus = storageStatus;
    file.sizeBytes = bytes.length;
    file.contentSha256 = createHash("sha256").update(bytes).digest("hex");
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);
    await expect(service.uploadApprovalVersion("version-1", "owner-1", {
      fileId: file.id,
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    })).rejects.toThrow(message);
  });

  it("rejects a byte digest mismatch", async () => {
    const bytes = await pdfBytes();
    const { file, prisma, files } = harness();
    file.sizeBytes = bytes.length;
    file.contentSha256 = "a".repeat(64);
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);
    await expect(service.uploadApprovalVersion("version-1", "owner-1", {
      fileId: file.id,
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    })).rejects.toThrow("合同 PDF 完整性校验失败");
  });

  it("turns a broken PDF into a persisted tagged denial", async () => {
    const bytes = Buffer.from("not-a-pdf");
    const { file, tx, prisma, files } = harness();
    file.sizeBytes = bytes.length;
    file.contentSha256 = createHash("sha256").update(bytes).digest("hex");
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-denied" }) };
    const service = new ContractFormalFileService(prisma as never, audit as never, files as never);

    await expect(service.uploadApprovalVersion("version-1", "owner-1", {
      fileId: file.id,
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    })).rejects.toThrow("无法读取合同 PDF 原件");
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.formal_file.file_denied"
    }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("提交预检不因 metadata-only 聚合修订误伤内容一致的正式文件", async () => {
    const bytes = await pdfBytes();
    const { file, tx, version, prisma, files } = harness();
    file.sizeBytes = bytes.length;
    file.contentSha256 = createHash("sha256").update(bytes).digest("hex");
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    tx.contractFormalFile.findFirst.mockResolvedValue({
      id: "formal-1",
      fileId: "file-1",
      contentSha256: file.contentSha256,
      pageCount: 1,
      sourceRevision: 2,
      status: "active",
      declarationSnapshot: {
        counterpartySigned: true,
        counterpartyStamped: true,
        crossPageSealCompleted: true,
        documentOrderConfirmed: true,
        authorizationsBeforeSignaturePageConfirmed: true,
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      }
    });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);
    await expect(service.assertReadyForSubmission(tx as never, version as never))
      .resolves.toMatchObject({ id: "formal-1", sourceRevision: 2 });
  });

  it("提交预检拒绝文书内容坐标不一致的正式文件", async () => {
    const { tx, version, prisma, files } = harness();
    tx.contractFormalFile.findFirst.mockResolvedValue({
      id: "formal-1",
      fileId: "file-1",
      contentSha256: "a".repeat(64),
      pageCount: 2,
      sourceRevision: 3,
      status: "active",
      declarationSnapshot: {
        counterpartySigned: true,
        counterpartyStamped: true,
        crossPageSealCompleted: true,
        documentOrderConfirmed: true,
        authorizationsBeforeSignaturePageConfirmed: true,
        documentContentRevision: 1,
        documentContentFingerprint: "c".repeat(64)
      }
    });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);
    await expect(service.assertReadyForSubmission(tx as never, version as never))
      .rejects.toThrow("正式审批文件已过期");
  });

  it("locks FileObject before rejecting an invalidated historical binding", async () => {
    const bytes = await pdfBytes();
    const { file, tx, prisma, files } = harness();
    file.sizeBytes = bytes.length;
    file.contentSha256 = createHash("sha256").update(bytes).digest("hex");
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    tx.contractFormalFile.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "formal-old", status: "invalidated" });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await expect(service.uploadApprovalVersion("version-1", "owner-1", {
      fileId: file.id,
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    })).rejects.toThrow("该文件已关联其他合同签署事实");
    const fileLockIndex = tx.$queryRaw.mock.calls.findIndex(
      ([query]: [{ strings?: readonly string[] }]) =>
        (query.strings?.join(" ") ?? "").includes('FROM "FileObject"')
    );
    expect(fileLockIndex).toBeGreaterThanOrEqual(0);
    expect(tx.$queryRaw.mock.invocationCallOrder[fileLockIndex])
      .toBeLessThan(tx.contractFormalFile.findFirst.mock.invocationCallOrder[2]);
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
  });

  it.each([
    ["P2034", "合同签前文件正在更新，请刷新后重试"],
    ["P2010", "合同签前文件正在更新，请刷新后重试"]
  ])("maps %s serialization conflicts to a stable business error", async (code, message) => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(
        code === "P2010" ? { code, meta: { code: "40001" } } : { code }
      )
    };
    const service = new ContractFormalFileService(prisma as never);
    await expect(service.uploadApprovalVersion("version-1", "owner-1", {
      fileId: "file-1",
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    })).rejects.toThrow(message);
  });

  it("returns the committed identical record after an active unique race", async () => {
    const input = {
      fileId: "file-1",
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    };
    const prisma = {
      $transaction: jest.fn().mockRejectedValue({ code: "P2002" }),
      contractFormalFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "formal-winner",
          contractVersionId: "version-1",
          purpose: "approval_original",
          status: "active",
          fileId: "file-1",
          sourceRevision: 3,
          declarationSnapshot: {
            ...input,
            documentOrder: "合同正文→全部附件和清单→所需授权委托书→最终签署页"
          }
        })
      }
    };
    const service = new ContractFormalFileService(prisma as never);
    await expect(service.uploadApprovalVersion("version-1", "owner-1", input))
      .resolves.toMatchObject({ id: "formal-winner" });
  });
});

describe("ContractFormalFileService.counterparty", () => {
  // 1x1 合法 PNG，供 pdf-lib 真实嵌入合并。
  const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  );
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  function counterpartyHarness(overrides: Record<string, unknown> = {}) {
    const version = {
      id: "version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 3,
      documentContentRevision: 2,
      documentContentFingerprint: "d".repeat(64),
      contractGovernanceVersion: 1
    };
    const formalFacts = {
      hasSignedFormalFile: false,
      hasActiveSealTask: false,
      hasArchiveFile: false,
      hasSettlement: false,
      hasPaymentRequest: false
    };
    const tx = {
      $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) return [version];
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }];
        }
        if (sql.includes('AS "hasSignedFormalFile"')) return [formalFacts];
        return [];
      }),
      contractFormalFile: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockImplementation(async ({ where, data }) => ({
          id: where.id,
          confirmedByUserId: data.confirmedByUserId ?? null,
          confirmedAt: data.confirmedAt ?? null,
          confirmationSnapshot: data.confirmationSnapshot ?? null
        })),
        create: jest.fn().mockImplementation(({ data }) => ({ id: `formal-${randomUUID()}`, ...data }))
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      fileObject: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findUnique: jest.fn() },
      contractFormalFile: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides
    };
    const files = {
      getFileBuffer: jest.fn(),
      uploadPrivateFile: jest.fn(),
      discardUnlinkedGeneratedFile: jest.fn().mockResolvedValue(undefined)
    };
    return { version, tx, prisma, files };
  }

  function makeFile(
    id: string,
    originalName: string,
    mimeType: string,
    bytes: Buffer
  ) {
    return {
      id,
      originalName,
      uploadedByUserId: "owner-1",
      storageStatus: "active",
      mimeType,
      sizeBytes: bytes.length,
      contentSha256: createHash("sha256").update(bytes).digest("hex")
    };
  }

  it("允许 DOCX 和图片扫描件作为双方最终归档原件，并保留原始摘要", async () => {
    const previewPdf = await pdfBytes();
    jest.mocked(convertDocxToPdf).mockResolvedValue(previewPdf);
    const { prisma, files } = counterpartyHarness();
    const docx = Buffer.from("final-contract-docx");
    const docxFile = makeFile("final-docx", "双方最终版.docx", DOCX_MIME, docx);
    const imageFile = makeFile("final-image", "双方最终版扫描件.png", "image/png", PNG_1PX);
    prisma.fileObject.findUnique
      .mockResolvedValueOnce(docxFile)
      .mockResolvedValueOnce(imageFile);
    files.getFileBuffer
      .mockResolvedValueOnce({ file: docxFile, buffer: docx })
      .mockResolvedValueOnce({ file: imageFile, buffer: PNG_1PX });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await expect(service.inspectOwnedStoredFinalArchive("final-docx", "owner-1"))
      .resolves.toMatchObject({
        sha256: docxFile.contentSha256,
        pageCount: 1,
        fileSnapshot: { mimeType: DOCX_MIME }
      });
    await expect(service.inspectOwnedStoredFinalArchive("final-image", "owner-1"))
      .resolves.toMatchObject({
        sha256: imageFile.contentSha256,
        pageCount: 1,
        fileSnapshot: { mimeType: "image/png" }
      });
  });

  it("上传单一 PDF：预览内联复用原文件，创建原始行与预览行并冻结到当前修订", async () => {
    const bytes = await pdfBytes();
    const { tx, prisma, files } = counterpartyHarness();
    const file = makeFile("file-1", "乙方签章.pdf", "application/pdf", bytes);
    prisma.fileObject.findUnique.mockResolvedValue(file);
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    const result = await service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["file-1"],
      sourceRevision: 3
    });
    expect(result).toMatchObject({
      originalFormalFileIds: [expect.any(String)],
      previewFormalFileId: expect.any(String),
      confirmationValid: false
    });
    expect(tx.contractFormalFile.create).toHaveBeenCalledTimes(2);
    const purposes = tx.contractFormalFile.create.mock.calls.map(
      (call: [{ data: { purpose: string } }]) => call[0].data.purpose
    );
    expect(purposes).toEqual(["counterparty_signed", "counterparty_signed_preview"]);
    const previewData = tx.contractFormalFile.create.mock.calls[1][0].data;
    expect(previewData).toMatchObject({
      fileId: "file-1",
      sourceRevision: 3,
      purpose: "counterparty_signed_preview"
    });
    expect(previewData.declarationSnapshot).toMatchObject({
      mode: "inline_pdf",
      documentContentRevision: 2,
      documentContentFingerprint: "d".repeat(64)
    });
    expect(tx.contractFormalFile.create.mock.calls[0][0].data.declarationSnapshot)
      .toMatchObject({
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      });
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("上传单一 DOCX：转换为 PDF 预览并创建新预览文件", async () => {
    const pdf = await pdfBytes();
    jest.mocked(convertDocxToPdf).mockResolvedValue(pdf);
    const { tx, prisma, files } = counterpartyHarness();
    const docx = Buffer.from("fake-docx");
    const file = makeFile("file-docx", "乙方签章.docx", DOCX_MIME, docx);
    prisma.fileObject.findUnique.mockResolvedValue(file);
    files.getFileBuffer.mockResolvedValue({ file, buffer: docx });
    files.uploadPrivateFile.mockResolvedValue({ id: "preview-file-1" });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["file-docx"],
      sourceRevision: 3
    });
    expect(files.uploadPrivateFile).toHaveBeenCalledWith(expect.objectContaining({
      originalName: "乙方签章.pdf",
      mimeType: "application/pdf",
      uploadedByUserId: "owner-1",
      sizeBytes: pdf.length
    }));
    const previewData = tx.contractFormalFile.create.mock.calls[1][0].data;
    expect(previewData).toMatchObject({ fileId: "preview-file-1", purpose: "counterparty_signed_preview" });
    expect(previewData.declarationSnapshot).toMatchObject({ mode: "converted_pdf" });
  });

  it("上传多张图片：合并为 A4 PDF 预览，每个原始文件一条记录", async () => {
    const { tx, prisma, files } = counterpartyHarness();
    prisma.fileObject.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "img-1"
        ? makeFile("img-1", "签章1.png", "image/png", PNG_1PX)
        : makeFile("img-2", "签章2.png", "image/png", PNG_1PX)
    );
    files.getFileBuffer.mockImplementation(async (id: string) => ({
      file: makeFile(id, id === "img-1" ? "签章1.png" : "签章2.png", "image/png", PNG_1PX),
      buffer: PNG_1PX
    }));
    files.uploadPrivateFile.mockResolvedValue({ id: "preview-file-1" });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["img-1", "img-2"],
      sourceRevision: 3
    });
    expect(tx.contractFormalFile.create).toHaveBeenCalledTimes(3);
    const originalPurposes = tx.contractFormalFile.create.mock.calls
      .slice(0, 2)
      .map((call: [{ data: { purpose: string } }]) => call[0].data.purpose);
    expect(originalPurposes).toEqual(["counterparty_signed", "counterparty_signed"]);
    const previewData = tx.contractFormalFile.create.mock.calls[2][0].data;
    expect(previewData).toMatchObject({ fileId: "preview-file-1", purpose: "counterparty_signed_preview" });
    expect(previewData.declarationSnapshot).toMatchObject({ mode: "merged_images_pdf" });
    expect(previewData.declarationSnapshot.sourceFileIds).toEqual(["img-1", "img-2"]);
  });

  it("拒绝混合格式（PDF + 图片），要求分批上传同类型", async () => {
    const pdf = await pdfBytes();
    const { tx, prisma, files } = counterpartyHarness();
    prisma.fileObject.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "a"
        ? makeFile("a", "合同.pdf", "application/pdf", pdf)
        : makeFile("b", "签章.png", "image/png", PNG_1PX)
    );
    files.getFileBuffer.mockImplementation(async (id: string) => ({
      file: makeFile(id, id === "a" ? "合同.pdf" : "签章.png", id === "a" ? "application/pdf" : "image/png", id === "a" ? pdf : PNG_1PX),
      buffer: id === "a" ? pdf : PNG_1PX
    }));
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await expect(service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["a", "b"],
      sourceRevision: 3
    })).rejects.toThrow("暂不支持混合格式");
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("只能关联本人上传的乙方签章文件", async () => {
    const bytes = await pdfBytes();
    const { prisma, files } = counterpartyHarness();
    const file = { ...makeFile("file-1", "签章.pdf", "application/pdf", bytes), uploadedByUserId: "other-1" };
    prisma.fileObject.findUnique.mockResolvedValue(file);
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await expect(service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["file-1"],
      sourceRevision: 3
    })).rejects.toThrow("只能关联本人本次上传的乙方签章文件");
  });

  it("最终驳回的结束申请不能上传或替代乙方签章文件", async () => {
    const bytes = await pdfBytes();
    const { version, tx, prisma, files } = counterpartyHarness();
    version.status = "approval_rejected";
    const file = makeFile("file-1", "乙方签章.pdf", "application/pdf", bytes);
    prisma.fileObject.findUnique.mockResolvedValue(file);
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await expect(service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["file-1"],
      sourceRevision: 3
    })).rejects.toThrow("已结束的合同申请仅可查看历史");

    expect(tx.contractFormalFile.updateMany).not.toHaveBeenCalled();
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
  });

  it("最终驳回的结束申请不能确认乙方签章预览", async () => {
    const { version, tx, prisma } = counterpartyHarness();
    version.status = "approval_rejected";
    tx.contractFormalFile.findFirst.mockResolvedValue({
      id: "preview-1",
      contractVersionId: "version-1",
      purpose: "counterparty_signed_preview",
      status: "active",
      sourceRevision: 3,
      declarationSnapshot: {
        kind: "counterparty_signed_preview",
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      }
    });
    const service = new ContractFormalFileService(prisma as never, undefined, undefined as never);

    await expect(service.confirmCounterpartySigned("version-1", "owner-1", {
      formalFileId: "preview-1",
      expectedDraftRevision: 3
    })).rejects.toThrow("已结束的合同申请仅可查看历史");

    expect(tx.contractFormalFile.update).not.toHaveBeenCalled();
  });

  it("草稿修订已变更时拒绝确认，并拒绝以旧修订上传", async () => {
    const { tx, prisma } = counterpartyHarness();
    const service = new ContractFormalFileService(prisma as never, undefined, undefined as never);
    await expect(service.confirmCounterpartySigned("version-1", "owner-1", {
      formalFileId: "preview-1",
      expectedDraftRevision: 2
    })).rejects.toThrow("合同草稿已更新");
    expect(tx.contractFormalFile.update).not.toHaveBeenCalled();
  });

  it("确认预览：仅聚合 metadata 变化时沿用相同文书内容证据", async () => {
    const { version, tx, prisma } = counterpartyHarness();
    version.draftRevision = 4;
    tx.contractFormalFile.findFirst.mockResolvedValue({
      id: "preview-1",
      contractVersionId: "version-1",
      purpose: "counterparty_signed_preview",
      status: "active",
      sourceRevision: 3,
      declarationSnapshot: {
        kind: "counterparty_signed_preview",
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      }
    });
    const service = new ContractFormalFileService(
      prisma as never,
      undefined,
      undefined as never
    );

    await expect(service.confirmCounterpartySigned("version-1", "owner-1", {
      formalFileId: "preview-1",
      expectedDraftRevision: 4
    })).resolves.toMatchObject({
      confirmedAtRevision: 4,
      confirmedDocumentContentRevision: 2,
      confirmedDocumentContentFingerprint: "d".repeat(64),
      confirmationValid: true
    });
  });

  it("确认预览：文书内容变化后拒绝旧预览", async () => {
    const { version, tx, prisma } = counterpartyHarness();
    version.documentContentRevision = 3;
    version.documentContentFingerprint = "e".repeat(64);
    tx.contractFormalFile.findFirst.mockResolvedValue({
      id: "preview-1",
      contractVersionId: "version-1",
      purpose: "counterparty_signed_preview",
      status: "active",
      sourceRevision: 3,
      declarationSnapshot: {
        kind: "counterparty_signed_preview",
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      }
    });
    const service = new ContractFormalFileService(
      prisma as never,
      undefined,
      undefined as never
    );

    await expect(service.confirmCounterpartySigned("version-1", "owner-1", {
      formalFileId: "preview-1",
      expectedDraftRevision: 3
    })).rejects.toThrow("合同文书内容已变化");
    expect(tx.contractFormalFile.update).not.toHaveBeenCalled();
  });

  it("确认预览：记录操作者、时间与冻结文书内容证据", async () => {
    const { tx, prisma } = counterpartyHarness();
    tx.contractFormalFile.findFirst.mockResolvedValue({
      id: "preview-1",
      contractVersionId: "version-1",
      purpose: "counterparty_signed_preview",
      status: "active",
      sourceRevision: 3,
      declarationSnapshot: {
        kind: "counterparty_signed_preview",
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      }
    });
    const service = new ContractFormalFileService(prisma as never, undefined, undefined as never);

    const result = await service.confirmCounterpartySigned("version-1", "owner-1", {
      formalFileId: "preview-1",
      expectedDraftRevision: 3
    });
    expect(result).toMatchObject({
      formalFileId: "preview-1",
      confirmedByUserId: "owner-1",
      confirmedAtRevision: 3,
      confirmedDocumentContentRevision: 2,
      confirmedDocumentContentFingerprint: "d".repeat(64),
      confirmationValid: true
    });
    expect(tx.contractFormalFile.update).toHaveBeenCalledWith(
      {
        where: { id: "preview-1" },
        data: expect.objectContaining({
          confirmedByUserId: "owner-1",
          confirmationSnapshot: {
            confirmedAtRevision: 3,
            documentContentRevision: 2,
            documentContentFingerprint: "d".repeat(64)
          }
        })
      }
    );
  });

  it("list 实时计算确认有效性：仅聚合 metadata 修订变更后仍然有效", async () => {
    const { prisma } = counterpartyHarness();
    prisma.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      draftRevision: 4,
      documentContentRevision: 2,
      documentContentFingerprint: "d".repeat(64),
      status: "draft"
    });
    prisma.contractFormalFile.findMany.mockResolvedValue([
      {
        id: "preview-1",
        contractVersionId: "version-1",
        purpose: "counterparty_signed_preview",
        fileId: "preview-file",
        contentSha256: "x".repeat(64),
        pageCount: 1,
        sourceRevision: 3,
        status: "active",
        uploadedByUserId: "owner-1",
        confirmedByUserId: "owner-1",
        confirmedAt: new Date("2026-01-01T00:00:00Z"),
        confirmationSnapshot: {
          confirmedAtRevision: 3,
          documentContentRevision: 2,
          documentContentFingerprint: "d".repeat(64)
        },
        declarationSnapshot: { kind: "counterparty_signed_preview", mode: "inline_pdf" },
        createdAt: new Date("2026-01-01T00:00:00Z")
      }
    ]);
    prisma.fileObject.findMany.mockResolvedValue([
      { id: "preview-file", originalName: "preview.pdf", mimeType: "application/pdf" }
    ]);
    const service = new ContractFormalFileService(prisma as never, undefined, undefined as never);

    const result = await service.listCounterpartySigned("version-1");
    expect(result).not.toHaveProperty("draftRevision");
    expect(result.confirmationValid).toBe(true);
    expect(result.preview).toMatchObject({
      confirmationValid: true,
      confirmedAtRevision: 3,
      confirmedDocumentContentRevision: 2,
      confirmedDocumentContentFingerprint: "d".repeat(64)
    });
  });

  it("list 实时计算确认有效性：文书内容变化后失效", async () => {
    const { prisma } = counterpartyHarness();
    prisma.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      draftRevision: 3,
      documentContentRevision: 3,
      documentContentFingerprint: "e".repeat(64),
      status: "draft"
    });
    prisma.contractFormalFile.findMany.mockResolvedValue([
      {
        id: "preview-1",
        contractVersionId: "version-1",
        purpose: "counterparty_signed_preview",
        fileId: "preview-file",
        contentSha256: "x".repeat(64),
        pageCount: 1,
        sourceRevision: 3,
        status: "active",
        uploadedByUserId: "owner-1",
        confirmedByUserId: "owner-1",
        confirmedAt: new Date("2026-01-01T00:00:00Z"),
        confirmationSnapshot: {
          confirmedAtRevision: 3,
          documentContentRevision: 2,
          documentContentFingerprint: "d".repeat(64)
        },
        declarationSnapshot: { kind: "counterparty_signed_preview", mode: "inline_pdf" },
        createdAt: new Date("2026-01-01T00:00:00Z")
      }
    ]);
    prisma.fileObject.findMany.mockResolvedValue([
      { id: "preview-file", originalName: "preview.pdf", mimeType: "application/pdf" }
    ]);
    const service = new ContractFormalFileService(prisma as never, undefined, undefined as never);

    const result = await service.listCounterpartySigned("version-1");
    expect(result.confirmationValid).toBe(false);
    expect(result.preview).toMatchObject({
      confirmationValid: false,
      confirmedDocumentContentRevision: 2,
      confirmedDocumentContentFingerprint: "d".repeat(64)
    });
  });

  it("事务失败时尽力清理新生成的预览文件，并映射序列化冲突", async () => {
    const pdf = await pdfBytes();
    jest.mocked(convertDocxToPdf).mockResolvedValue(pdf);
    const { prisma, files } = counterpartyHarness();
    const docx = Buffer.from("fake-docx");
    const file = makeFile("file-docx", "签章.docx", DOCX_MIME, docx);
    prisma.fileObject.findUnique.mockResolvedValue(file);
    files.getFileBuffer.mockResolvedValue({ file, buffer: docx });
    files.uploadPrivateFile.mockResolvedValue({ id: "preview-file-1" });
    prisma.$transaction = jest.fn().mockRejectedValue({ code: "P2034" });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await expect(service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["file-docx"],
      sourceRevision: 3
    })).rejects.toThrow("乙方签章文件正在更新，请刷新后重试");
    expect(files.discardUnlinkedGeneratedFile).toHaveBeenCalledWith("preview-file-1", "owner-1");
  });

  it("重复上传会先替代旧的一批原始行与预览行", async () => {
    const bytes = await pdfBytes();
    const { tx, prisma, files } = counterpartyHarness();
    const file = makeFile("file-1", "乙方签章.pdf", "application/pdf", bytes);
    prisma.fileObject.findUnique.mockResolvedValue(file);
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    await service.uploadCounterpartySigned("version-1", "owner-1", {
      fileIds: ["file-1"],
      sourceRevision: 3
    });
    expect(tx.contractFormalFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractVersionId: "version-1",
          purpose: { in: ["counterparty_signed", "counterparty_signed_preview"] }
        }),
        data: expect.objectContaining({ status: "superseded" })
      })
    );
  });
});

describe("ContractFormalFileService.bridgeFromCounterparty", () => {
  it("提交桥接沿用 metadata-only 变化前的有效签章确认并冻结 fingerprint", async () => {
    const bytes = await pdfBytes();
    const pdf = await PDFDocument.load(bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const preview = {
      id: "preview-1",
      fileId: "file-1",
      contentSha256: sha256,
      pageCount: pdf.getPageCount(),
      sourceRevision: 3,
      status: "active",
      confirmedByUserId: "owner-1",
      uploadedByUserId: "owner-1",
      confirmationSnapshot: {
        confirmedAtRevision: 3,
        documentContentRevision: 2,
        documentContentFingerprint: "d".repeat(64)
      }
    };
    const { version, file, tx, prisma, files } = harness();
    version.draftRevision = 4;
    file.sizeBytes = bytes.length;
    file.contentSha256 = sha256;
    files.getFileBuffer.mockResolvedValue({ file, buffer: bytes });
    tx.contractFormalFile.findFirst
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({
        id: "old-formal-1",
        fileId: "file-old",
        contentSha256: "a".repeat(64),
        pageCount: 1,
        sourceRevision: 2,
        status: "active",
        declarationSnapshot: {}
      });
    tx.contractFormalFile.findMany.mockResolvedValueOnce([
      {
        id: "counterparty-original-1",
        fileId: "file-1",
        contentSha256: sha256,
        sourceRevision: 3
      }
    ]);
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractFormalFileService(prisma as never, audit as never, files as never);

    const result = await service.freezeFromCounterparty(tx as never, version as never);

    expect(result).toEqual(expect.objectContaining({
      fileId: "file-1",
      contentSha256: sha256,
      pageCount: pdf.getPageCount(),
      sourceRevision: 4
    }));
    const createData = tx.contractFormalFile.create.mock.calls[0][0].data;
    expect(createData.purpose).toBe("approval_original");
    expect(createData.fileId).toBe("file-1");
    expect(createData.sourceRevision).toBe(4);
    expect(createData.uploadedByUserId).toBe("owner-1");
    expect(createData.declaredByUserId).toBe("owner-1");
    expect(createData.supersedesId).toBe("old-formal-1");
    expect(createData.declarationSnapshot).toMatchObject({
      kind: "counterparty_bridge",
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    });
    expect(createData.declarationSnapshot._counterparty_confirmed).toMatchObject({
      confirmedAtRevision: 3,
      documentContentRevision: 2,
      documentContentFingerprint: "d".repeat(64),
      formalFileId: "preview-1",
      sourceFiles: [
        {
          formalFileId: "counterparty-original-1",
          fileId: "file-1",
          contentSha256: sha256,
          sourceRevision: 3
        }
      ]
    });
    expect(tx.contractFormalFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractVersionId: "version-1",
          purpose: "approval_original",
          status: "active"
        }),
        data: expect.objectContaining({
          status: "superseded",
          invalidationReason: "已按乙方签章文件确认重新生成审批文件"
        })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.formal_file.approval_bridge_from_counterparty"
    }));
  });

  it("预览未确认时桥接返回 null，由调用方回退旧审批文件路径", async () => {
    const { version, tx, prisma, files } = harness();
    tx.contractFormalFile.findFirst.mockResolvedValueOnce({
      id: "preview-1",
      fileId: "file-1",
      contentSha256: "a".repeat(64),
      pageCount: 1,
      sourceRevision: 3,
      status: "active",
      confirmedByUserId: null,
      confirmationSnapshot: null
    });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    const result = await service.freezeFromCounterparty(tx as never, version as never);

    expect(result).toBeNull();
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
  });

  it("确认文书 fingerprint 与当前内容不同时桥接返回 null", async () => {
    const { version, tx, prisma, files } = harness();
    tx.contractFormalFile.findFirst.mockResolvedValueOnce({
      id: "preview-1",
      fileId: "file-1",
      contentSha256: "a".repeat(64),
      pageCount: 1,
      sourceRevision: 3,
      status: "active",
      confirmedByUserId: "owner-1",
      confirmationSnapshot: {
        confirmedAtRevision: 3,
        documentContentRevision: 2,
        documentContentFingerprint: "e".repeat(64)
      }
    });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    const result = await service.freezeFromCounterparty(tx as never, version as never);

    expect(result).toBeNull();
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
  });

  it("确认快照缺少文书 fingerprint 时桥接返回 null", async () => {
    const { version, tx, prisma, files } = harness();
    tx.contractFormalFile.findFirst.mockResolvedValueOnce({
      id: "preview-1",
      fileId: "file-1",
      contentSha256: "a".repeat(64),
      pageCount: 1,
      sourceRevision: 3,
      status: "active",
      confirmedByUserId: "owner-1",
      confirmationSnapshot: { confirmedAtRevision: 2 }
    });
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    const result = await service.freezeFromCounterparty(tx as never, version as never);

    expect(result).toBeNull();
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
  });

  it("非治理版草稿直接返回 null，不查询预览", async () => {
    const { version, tx, prisma, files } = harness();
    const service = new ContractFormalFileService(prisma as never, undefined, files as never);

    const result = await service.freezeFromCounterparty(
      tx as never,
      { ...version, contractGovernanceVersion: 0 } as never
    );

    expect(result).toBeNull();
    expect(tx.contractFormalFile.findFirst).not.toHaveBeenCalled();
  });
});

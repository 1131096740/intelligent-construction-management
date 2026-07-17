import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { ContractFormalFileService } from "./contract-formal-file.service";

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
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }])
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([file]),
    contractFormalFile: {
      findFirst: jest.fn().mockResolvedValue(null),
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
  return { version, file, tx, prisma, files };
}

describe("ContractFormalFileService", () => {
  it("关联当前修订的完整乙方签章审批 PDF，并使相同重试幂等", async () => {
    const bytes = await pdfBytes();
    const { file, tx, prisma, files } = harness();
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
    expect(firstData).toMatchObject({ purpose: "approval_original" });
    tx.contractFormalFile.findFirst.mockResolvedValue({ id: "formal-1", ...firstData });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }])
      .mockResolvedValueOnce([{ ...harness().version }])
      .mockResolvedValueOnce([file]);
    await service.uploadApprovalVersion("version-1", "owner-1", input);
    expect(tx.contractFormalFile.create).toHaveBeenCalledTimes(1);
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

  it("提交时只接受当前修订的一条 active 正式文件", async () => {
    const { tx, version, prisma, files } = harness();
    tx.contractFormalFile.findFirst.mockResolvedValue({
      id: "formal-1",
      fileId: "file-1",
      contentSha256: "a".repeat(64),
      pageCount: 2,
      sourceRevision: 2,
      status: "active",
      declarationSnapshot: {}
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
    expect(tx.$queryRaw.mock.invocationCallOrder[2])
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

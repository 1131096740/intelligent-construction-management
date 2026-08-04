import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  SettlementCounterpartyDocumentService,
  SettlementDocumentGovernanceDenial
} from "./settlement-counterparty-document.service";

const declaration = {
  pageOrderMatchesFrozenDocument: true,
  counterpartySignedAndDated: true,
  everyPageStamped: true,
  crossPageSealCompleted: true
};

async function landscapePdf() {
  const document = await PDFDocument.create();
  document.addPage([841.89, 595.28]);
  return Buffer.from(await document.save());
}

async function multiPageLandscapePdf() {
  const document = await PDFDocument.create();
  document.addPage([841.89, 595.28]);
  document.addPage([841.89, 595.28]);
  return Buffer.from(await document.save());
}

async function portraitPdf() {
  const document = await PDFDocument.create();
  document.addPage([595.28, 841.89]);
  return Buffer.from(await document.save());
}

function lifecycleDelegates(draft: Record<string, unknown>) {
  return {
    settlementDraft: {
      findUnique: jest.fn().mockResolvedValue({
        contractId: "contract-1",
        contractVersionId: "version-1",
        code: "JS-DRAFT-001",
        processId: null,
        submittedSettlementId: null,
        submittedAt: null,
        abandonReason: null,
        ...draft
      })
    },
    contractSettlementProcess: { findMany: jest.fn().mockResolvedValue([]) },
    settlement: { findMany: jest.fn().mockResolvedValue([]) },
    paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
    approvalInstance: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

describe("SettlementCounterpartyDocumentService", () => {
  it("links the original uploaded PDF to the current frozen draft revision without rewriting bytes", async () => {
    const buffer = await landscapePdf();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const draft = { id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", revision: 3, status: "draft", governanceVersion: 1 };
    const frozen = { id: "frozen-1", settlementDraftId: "draft-1", purpose: "frozen_counterparty_copy", fileId: "frozen-file", contentSha256: sha256, pageCount: 1, sourceRevision: 3, businessSnapshotToken: "snapshot-3", status: "active", declarationSnapshot: null, supersedesId: null };
    const file = (id: string) => ({ id, uploadedByUserId: "owner-1", storageStatus: "active", mimeType: "application/pdf", sizeBytes: buffer.length, contentSha256: sha256 });
    const $queryRaw = jest.fn()
      .mockResolvedValueOnce([draft])
      .mockResolvedValueOnce([frozen])
      .mockResolvedValueOnce([file("frozen-file")])
      .mockResolvedValueOnce([file("uploaded-file")]);
    const created = { id: "signed-1", pageCount: 1 };
    const tx = {
      $queryRaw,
      ...lifecycleDelegates(draft),
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const files = { getFileBuffer: jest.fn(async (id: string) => ({ file: file(id), buffer })) };
    const service = new SettlementCounterpartyDocumentService(prisma as never, undefined, files as never);

    await expect(service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-file",
      declaration: { ...declaration, crossPageSealCompleted: false }
    })).resolves.toEqual(created);

    expect(files.getFileBuffer).toHaveBeenCalledTimes(2);
    expect(tx.settlementSignedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementDraftId: "draft-1",
        purpose: "counterparty_signed_original",
        fileId: "uploaded-file",
        contentSha256: sha256,
        pageCount: 1,
        sourceRevision: 3,
        businessSnapshotToken: "snapshot-3",
        declarationSnapshot: expect.objectContaining({
          ...declaration,
          crossPageSealCompleted: false,
          pdfInspection: expect.objectContaining({
            frozenPageCount: 1,
            originalPageCount: 1,
            hasDifferences: false
          })
        }),
        uploadedByUserId: "owner-1"
      })
    });
  });

  it("rejects a multi-page PDF without the cross-page seal declaration", async () => {
    const buffer = await multiPageLandscapePdf();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const draft = { id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", revision: 3, status: "draft", governanceVersion: 1 };
    const frozen = { id: "frozen-1", settlementDraftId: "draft-1", purpose: "frozen_counterparty_copy", fileId: "frozen-file", contentSha256: sha256, pageCount: 2, sourceRevision: 3, businessSnapshotToken: "snapshot-3", status: "active", declarationSnapshot: null, supersedesId: null };
    const file = (id: string) => ({ id, uploadedByUserId: "owner-1", storageStatus: "active", mimeType: "application/pdf", sizeBytes: buffer.length, contentSha256: sha256 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([draft]).mockResolvedValueOnce([frozen]).mockResolvedValueOnce([file("frozen-file")]).mockResolvedValueOnce([file("uploaded-file")]),
      ...lifecycleDelegates(draft),
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn()
      }
    };
    const files = { getFileBuffer: jest.fn(async (id: string) => ({ file: file(id), buffer })) };
    const service = new SettlementCounterpartyDocumentService({ $transaction: jest.fn(async (callback) => callback(tx)) } as never, undefined, files as never);

    await expect(service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-file",
      declaration: { ...declaration, crossPageSealCompleted: false }
    })).rejects.toThrow("请逐项确认");
    expect(tx.settlementSignedDocument.create).not.toHaveBeenCalled();
  });

  it("allows a readable signed scan with page-layout differences and freezes the inspection facts", async () => {
    const frozenBuffer = await multiPageLandscapePdf();
    const uploadedBuffer = await portraitPdf();
    const frozenSha256 = createHash("sha256").update(frozenBuffer).digest("hex");
    const uploadedSha256 = createHash("sha256").update(uploadedBuffer).digest("hex");
    const draft = { id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", revision: 3, status: "draft", governanceVersion: 1 };
    const frozen = { id: "frozen-1", settlementDraftId: "draft-1", purpose: "frozen_counterparty_copy", fileId: "frozen-file", contentSha256: frozenSha256, pageCount: 2, sourceRevision: 3, businessSnapshotToken: "snapshot-3", status: "active", declarationSnapshot: null, supersedesId: null };
    const file = (id: string, buffer: Buffer, contentSha256: string) => ({ id, uploadedByUserId: "owner-1", storageStatus: "active", mimeType: "application/pdf", sizeBytes: buffer.length, contentSha256 });
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([frozen])
        .mockResolvedValueOnce([file("frozen-file", frozenBuffer, frozenSha256)])
        .mockResolvedValueOnce([file("uploaded-file", uploadedBuffer, uploadedSha256)]),
      ...lifecycleDelegates(draft),
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "signed-1" }),
        update: jest.fn()
      }
    };
    const files = {
      getFileBuffer: jest.fn(async (id: string) => id === "frozen-file"
        ? { file: file(id, frozenBuffer, frozenSha256), buffer: frozenBuffer }
        : { file: file(id, uploadedBuffer, uploadedSha256), buffer: uploadedBuffer })
    };
    const service = new SettlementCounterpartyDocumentService({ $transaction: jest.fn(async (callback) => callback(tx)) } as never, undefined, files as never);

    await expect(service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-file",
      declaration
    })).resolves.toMatchObject({ id: "signed-1" });

    expect(tx.settlementSignedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contentSha256: uploadedSha256,
        declarationSnapshot: expect.objectContaining({
          ...declaration,
          pdfInspection: expect.objectContaining({
            frozenPageCount: 2,
            originalPageCount: 1,
            hasDifferences: true,
            differences: expect.arrayContaining(["page_count", "orientation"])
          })
        })
      })
    });
  });

  it("locks the frozen and uploaded FileObject rows in stable file-id order", async () => {
    const buffer = await landscapePdf();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const draft = { id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", revision: 3, status: "draft", governanceVersion: 1 };
    const frozen = { id: "frozen-1", settlementDraftId: "draft-1", purpose: "frozen_counterparty_copy", fileId: "z-frozen", contentSha256: sha256, pageCount: 1, sourceRevision: 3, businessSnapshotToken: "snapshot-3", status: "active", declarationSnapshot: null, supersedesId: null };
    const file = (id: string) => ({ id, uploadedByUserId: "owner-1", storageStatus: "active", mimeType: "application/pdf", sizeBytes: buffer.length, contentSha256: sha256 });
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([frozen])
        .mockResolvedValueOnce([file("a-uploaded")])
        .mockResolvedValueOnce([file("z-frozen")]),
      ...lifecycleDelegates(draft),
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "signed-1" }),
        update: jest.fn()
      }
    };
    const files = {
      getFileBuffer: jest.fn(async (id: string) => ({ file: file(id), buffer }))
    };
    const service = new SettlementCounterpartyDocumentService({
      $transaction: jest.fn(async (callback) => callback(tx))
    } as never, undefined, files as never);

    await service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "a-uploaded",
      declaration
    });

    expect(files.getFileBuffer.mock.calls.map(([fileId]) => fileId)).toEqual([
      "a-uploaded",
      "z-frozen"
    ]);
  });

  it("rejects a draft reached through a different project route", async () => {
    const draft = {
      id: "draft-1",
      projectId: "project-2",
      ownerUserId: "owner-1",
      revision: 3,
      status: "draft",
      governanceVersion: 1
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([draft]),
      ...lifecycleDelegates(draft),
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const service = new SettlementCounterpartyDocumentService({
      $transaction: jest.fn(async (callback) => callback(tx))
    } as never);

    await expect(service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-file",
      declaration
    })).rejects.toThrow("未找到当前项目的结算草稿");
    expect(tx.settlementSignedDocument.create).not.toHaveBeenCalled();
  });

  it("fails closed before linking a scan to a marker-drift formal draft", async () => {
    const draft = {
      id: "draft-1",
      projectId: "project-1",
      ownerUserId: "owner-1",
      revision: 3,
      status: "draft",
      governanceVersion: 1,
      processId: "process-1"
    };
    const delegates = lifecycleDelegates(draft);
    delegates.contractSettlementProcess.findMany.mockResolvedValueOnce([{
      id: "process-1",
      settlementDraftId: "draft-1",
      settlementId: "settlement-1"
    }]);
    delegates.settlement.findMany.mockResolvedValueOnce([{
      id: "settlement-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      code: "JS-DRAFT-001",
      processId: "process-1"
    }]);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{ id: "draft-1" }]),
      ...delegates,
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const service = new SettlementCounterpartyDocumentService({
      $transaction: jest.fn(async (callback) => callback(tx))
    } as never);

    await expect(service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-file",
      declaration
    })).rejects.toThrow("已形成正式结算");

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.settlementSignedDocument.create).not.toHaveBeenCalled();
  });

  it("blocks submission until both current-revision documents exist", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const service = new SettlementCounterpartyDocumentService({} as never);

    await expect(service.assertReadyForSubmission(tx as never, {
      id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", revision: 3, status: "draft", governanceVersion: 1
    })).rejects.toThrow("请先生成并冻结当前修订版结算单");
  });

  it("persists a tagged denial in an independent audit transaction", async () => {
    const tx = {};
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new SettlementCounterpartyDocumentService(
      prisma as never,
      audit as never
    );
    const denial = new SettlementDocumentGovernanceDenial(
      "请先上传乙方完整签章扫描件",
      "settlement.submission.counterparty_document_denied"
    );

    await service.persistDenial("draft-1", "owner-1", denial);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "owner-1",
      action: "settlement.submission.counterparty_document_denied",
      businessType: "settlement_draft",
      businessId: "draft-1",
      metadata: {
        tag: "settlement.submission.counterparty_document_denied",
        reason: "请先上传乙方完整签章扫描件"
      }
    });
  });

  it.each([
    { code: "P2034" },
    { code: "P2010", meta: { code: "40001" } }
  ])("maps serialization conflicts to a stable retry message", async (error) => {
    const service = new SettlementCounterpartyDocumentService({
      $transaction: jest.fn().mockRejectedValue(error)
    } as never);

    await expect(service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-file",
      declaration
    })).rejects.toThrow("结算签章文件正在更新，请刷新后重试");
  });

  it("returns the committed identical record after an active unique race", async () => {
    const winner = {
      id: "signed-winner",
      settlementDraftId: "draft-1",
      purpose: "counterparty_signed_original",
      status: "active",
      fileId: "uploaded-file",
      sourceRevision: 3,
      declarationSnapshot: declaration
    };
    const service = new SettlementCounterpartyDocumentService({
      $transaction: jest.fn().mockRejectedValue({ code: "P2002" }),
      settlementSignedDocument: {
        findFirst: jest.fn().mockResolvedValue(winner)
      }
    } as never);

    await expect(service.link("project-1", "draft-1", "owner-1", {
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-file",
      declaration
    })).resolves.toBe(winner);
  });

  it.each([
    ["another uploader", { uploadedByUserId: "other" }, "只能关联本人"],
    ["inactive storage", { storageStatus: "superseded" }, "不存在、格式不正确或大小超限"],
    ["non PDF", { mimeType: "image/png" }, "不存在、格式不正确或大小超限"],
    ["oversize", { sizeBytes: 104_857_601 }, "不存在、格式不正确或大小超限"],
    ["invalid database hash", { contentSha256: "bad" }, "完整性摘要异常"]
  ])("rejects %s before any document binding", async (_label, patch, message) => {
    const buffer = await landscapePdf();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const file = { id: "file-1", uploadedByUserId: "owner-1", storageStatus: "active", mimeType: "application/pdf", sizeBytes: buffer.length, contentSha256: sha256, ...patch };
    const service = new SettlementCounterpartyDocumentService({} as never, undefined, {
      getFileBuffer: jest.fn().mockResolvedValue({ file, buffer })
    } as never);
    const inspect = service as unknown as { inspectFile(tx: unknown, fileId: string, expectedSha: undefined, owner: string): Promise<unknown> };

    await expect(inspect.inspectFile({ $queryRaw: jest.fn().mockResolvedValue([file]) }, "file-1", undefined, "owner-1")).rejects.toThrow(message);
  });

  it("rejects changed original bytes even when FileObject metadata still carries the old hash", async () => {
    const buffer = await landscapePdf();
    const changed = Buffer.concat([buffer, Buffer.from("tampered")]);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const file = { id: "file-1", uploadedByUserId: "owner-1", storageStatus: "active", mimeType: "application/pdf", sizeBytes: changed.length, contentSha256: sha256 };
    const service = new SettlementCounterpartyDocumentService({} as never, undefined, { getFileBuffer: jest.fn().mockResolvedValue({ file, buffer: changed }) } as never);
    const inspect = service as unknown as { inspectFile(tx: unknown, fileId: string, expectedSha: undefined, owner: string): Promise<unknown> };

    await expect(inspect.inspectFile({ $queryRaw: jest.fn().mockResolvedValue([file]) }, "file-1", undefined, "owner-1")).rejects.toThrow("原字节完整性校验失败");
  });

  it.each([
    ["stale revision", [
      { id: "f", settlementDraftId: "draft-1", purpose: "frozen_counterparty_copy", sourceRevision: 2, status: "active" }
    ], "请先生成并冻结"],
    ["snapshot token mismatch", [
      { id: "f", settlementDraftId: "draft-1", purpose: "frozen_counterparty_copy", sourceRevision: 3, status: "active", businessSnapshotToken: "a" },
      { id: "o", settlementDraftId: "draft-1", purpose: "counterparty_signed_original", sourceRevision: 3, status: "active", businessSnapshotToken: "b", pageCount: 1, declarationSnapshot: declaration }
    ], "与当前冻结版不一致"]
  ])("rejects %s at submission without consuming stale evidence", async (_label, partialRows, message) => {
    const rows = partialRows.map((row) => ({ fileId: `${row.id}-file`, contentSha256: "a".repeat(64), pageCount: 1, declarationSnapshot: null, supersedesId: null, ...row }));
    const service = new SettlementCounterpartyDocumentService({} as never);
    await expect(service.assertReadyForSubmission({ $queryRaw: jest.fn().mockResolvedValue(rows) } as never, {
      id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", revision: 3, status: "draft", governanceVersion: 1
    })).rejects.toThrow(message);
  });

  it.each([
    ["cross parent or purpose", [
      { id: "a", supersedesId: "missing" }
    ], "替代关系异常"],
    ["one old document with multiple successors", [
      { id: "a", supersedesId: null }, { id: "b", supersedesId: "a" }, { id: "c", supersedesId: "a" }
    ], "多个替代件"],
    ["replacement cycle", [
      { id: "a", supersedesId: "b" }, { id: "b", supersedesId: "a" }
    ], "形成循环"]
  ])("rejects %s while rows are locked", async (_label, links, message) => {
    const base = { settlementDraftId: "draft-1", purpose: "counterparty_signed_original", fileId: "file", contentSha256: "a".repeat(64), pageCount: 1, sourceRevision: 3, businessSnapshotToken: "s", status: "superseded", declarationSnapshot: declaration };
    const tx = { $queryRaw: jest.fn().mockResolvedValue(links.map((link) => ({ ...base, ...link }))) };
    const service = new SettlementCounterpartyDocumentService({} as never);

    await expect(service.assertReadyForSubmission(tx as never, {
      id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", revision: 3, status: "draft", governanceVersion: 1
    })).rejects.toThrow(message);
  });
});

import { SettlementLineAttachmentService } from "./settlement-line-attachment.service";

describe("SettlementLineAttachmentService", () => {
  function context() {
    const audit = { record: jest.fn() };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{
        id: "draft-1", projectId: "project-1", ownerUserId: "owner-1", status: "draft", revision: 3
      }]),
      settlementDraftLine: {
        findFirst: jest.fn().mockResolvedValue({ id: "draft-line-1", lineKey: "visa:visa-1" }),
        findMany: jest.fn()
      },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "owner-1", storageStatus: "active" }) },
      settlementLineAttachment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "attachment-1" }),
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn()
      },
      settlementDraft: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn() },
      settlementSignedDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      settlementLine: { findMany: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)), settlementDraft: tx.settlementDraft };
    return { tx, audit, service: new SettlementLineAttachmentService(prisma as never, audit as never) };
  }

  it("binds only the current owner's active upload, advances the revision, and invalidates frozen evidence", async () => {
    const { tx, audit, service } = context();

    await expect(service.attachToDraftLine("project-1", "draft-1", "visa:visa-1", "owner-1", {
      fileId: "file-1", purpose: "现场签证单", expectedRevision: 3
    })).resolves.toMatchObject({ revision: 4, idempotent: false });

    expect(tx.settlementLineAttachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ settlementDraftLineId: "draft-line-1", fileId: "file-1", purpose: "现场签证单" })
    });
    expect(tx.settlementDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "draft-1", status: "draft", revision: 3 }
    }));
    expect(tx.settlementSignedDocument.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "settlement.line_attachment.attach" }));
  });

  it("copies active draft attachment facts to matching formal line keys without moving the source file", async () => {
    const { tx, audit, service } = context();
    tx.settlementDraftLine.findMany.mockResolvedValue([{ id: "draft-line-1", lineKey: "visa:visa-1" }]);
    tx.settlementLine.findMany.mockResolvedValue([{ id: "settlement-line-1", lineKey: "visa:visa-1" }]);
    tx.settlementLineAttachment.findMany.mockResolvedValue([{ fileId: "file-1", purpose: "现场签证单", uploadedByUserId: "owner-1", settlementDraftLineId: "draft-line-1" }]);

    await service.copyActiveDraftAttachmentsToSettlement(tx as never, "draft-1", "settlement-1", "owner-1");

    expect(tx.settlementLineAttachment.createMany).toHaveBeenCalledWith({
      data: [{ settlementLineId: "settlement-line-1", fileId: "file-1", purpose: "现场签证单", uploadedByUserId: "owner-1" }]
    });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "settlement.line_attachment.copy_to_settlement" }));
  });
});

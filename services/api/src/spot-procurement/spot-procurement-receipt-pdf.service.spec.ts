import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import sharpModule = require("sharp");
import {
  RECEIPT_PDF_BUSINESS_TYPE,
  RECEIPT_PDF_TEMPLATE_KEY,
  SpotProcurementReceiptPdfService,
  renderSpotProcurementReceiptPdf,
  type ReceiptPdfRenderInput,
  type ReceiptPdfSnapshot
} from "./spot-procurement-receipt-pdf.service";

const sharp = sharpModule as unknown as typeof import("sharp").default;

const sourceTime = new Date("2026-07-17T08:00:00.000Z");
const submittedAt = new Date("2026-07-17T08:30:00.000Z");
const reviewedAt = new Date("2026-07-17T09:00:00.000Z");

function renderInput(overrides: Partial<ReceiptPdfRenderInput> = {}): ReceiptPdfRenderInput {
  return {
    projectCode: "XM-001",
    projectName: "滨江项目",
    procurementCode: "LXCG-2026-001",
    procurementVersionNo: 1,
    receiptRevisionNo: 2,
    receiptStatus: "returned",
    supplierName: "城东建材商店",
    handlerName: "物资员甲",
    submittedByName: "受托人乙",
    submittedAt,
    delegationSummary: "物资员甲委托受托人乙办理收货确认",
    receiptNote: "现场核对完成",
    approvedAmountCents: 10_000n,
    actualCostCents: 7_200n,
    differenceAmountCents: 2_800n,
    lines: [
      {
        sortOrder: 1,
        materialName: "免烧砖",
        specification: "240x115x53",
        unit: "块",
        frozenUnitPrice: "0.800000",
        approvedQuantity: "100.000000",
        qualifiedQuantity: "90.000000",
        unqualifiedQuantity: "5.000000",
        freeGiftQuantity: "2.000000",
        discrepancy: "少货 10.000000 块",
        note: "5块破损",
        actualCostCents: 7_200n
      }
    ],
    review: {
      id: "review-return-2",
      decision: "returned",
      conclusion: "退回修改",
      reviewerName: "物资主管丙",
      reviewedAt,
      comment: "请补充送货单",
      targetReviewId: null
    },
    photos: [],
    generatedAt: new Date("2026-07-17T09:05:00.000Z"),
    ...overrides
  };
}

function snapshot(overrides: Partial<ReceiptPdfSnapshot> = {}): ReceiptPdfSnapshot {
  const input = renderInput();
  return {
    token: {
      receiptId: "receipt-1",
      receiptUpdatedAt: sourceTime.toISOString(),
      currentRevisionNo: 3,
      receiptStatus: "returned",
      sourceRevisionNo: 2,
      sourceRevisionUpdatedAt: sourceTime.toISOString(),
      reviewId: "review-return-2",
      latestReviewId: "review-return-2",
      factFingerprint: "facts-v1"
    },
    renderInput: input,
    photoFacts: [
      {
        id: "photo-scene-r1",
        receiptRevisionNo: 1,
        watermarkedFileId: "wm-scene-r1",
        watermarkedSha256: "a".repeat(64),
        category: "material_scene",
        source: "camera",
        note: "首次到货",
        appendReason: null,
        uploadedByName: "物资员甲",
        serverRecordedAt: sourceTime,
        lockedAt: submittedAt
      },
      {
        id: "photo-delivery-r2",
        receiptRevisionNo: 2,
        watermarkedFileId: "wm-delivery-r2",
        watermarkedSha256: "b".repeat(64),
        category: "delivery_note",
        source: "album",
        note: "送货单",
        appendReason: "按退回意见补充",
        uploadedByName: "受托人乙",
        serverRecordedAt: reviewedAt,
        lockedAt: reviewedAt
      }
    ],
    ...overrides
  };
}

function fileBuffer(id: string, buffer: Buffer, sha256: string) {
  return {
    file: {
      id,
      bucket: "private",
      objectKey: `uploads/${id}.png`,
      originalName: `${id}.png`,
      mimeType: "image/png",
      sizeBytes: buffer.length,
      uploadedByUserId: "handler-1",
      contentSha256: sha256,
      storageStatus: "active",
      supersedesFileObjectId: null,
      createdAt: sourceTime
    },
    buffer
  };
}

describe("SpotProcurementReceiptPdfService", () => {
  it("以复核发生的旧修订投影全部字段，且只累积同采购版本不晚于目标修订的照片", async () => {
    const client = sourceClient();
    const service = new SpotProcurementReceiptPdfService(
      {} as never,
      {} as never,
      { record: jest.fn() } as never
    );

    const result = await (
      service as unknown as {
        loadSourceSnapshot(
          tx: unknown,
          receiptId: string,
          projection: { sourceRevisionNo?: number; reviewId?: string }
        ): Promise<ReceiptPdfSnapshot>;
      }
    ).loadSourceSnapshot(client, "receipt-1", {
      sourceRevisionNo: 2,
      reviewId: "review-return-2"
    });

    expect(result.renderInput).toMatchObject({
      projectCode: "XM-001",
      projectName: "滨江项目",
      procurementCode: "LXCG-2026-001",
      supplierName: "城东建材商店",
      handlerName: "物资员甲",
      submittedByName: "受托人乙",
      approvedAmountCents: 10_000n,
      actualCostCents: 7_200n,
      differenceAmountCents: 2_800n,
      review: expect.objectContaining({
        id: "review-return-2",
        decision: "returned",
        reviewerName: "物资主管丙",
        reviewedAt
      })
    });
    expect(result.renderInput.lines).toEqual([
      expect.objectContaining({
        materialName: "免烧砖",
        approvedQuantity: "100",
        qualifiedQuantity: "90",
        unqualifiedQuantity: "5",
        freeGiftQuantity: "2",
        actualCostCents: 7_200n
      })
    ]);
    expect(result.photoFacts.map((photo) => photo.watermarkedFileId)).toEqual([
      "wm-scene-r1",
      "wm-delivery-r2"
    ]);
    expect(client.spotProcurementReceiptPhoto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          receiptId: "receipt-1",
          receiptRevisionNo: { in: [1, 2] }
        }
      })
    );
    expect(result.token).toEqual(
      expect.objectContaining({
        sourceRevisionNo: 2,
        reviewId: "review-return-2",
        latestReviewId: "review-return-2",
        factFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    );
  });

  it("拒绝超过收货证据数量上限的异常存量数据", async () => {
    const client = sourceClient();
    client.spotProcurementReceiptPhoto.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        id: `photo-${index + 1}`
      }))
    );
    const service = new SpotProcurementReceiptPdfService(
      {} as never,
      {} as never,
      { record: jest.fn() } as never
    );

    await expect(
      (
        service as unknown as {
          loadSourceSnapshot(
            tx: unknown,
            receiptId: string,
            projection: {
              sourceRevisionNo?: number;
              reviewId?: string;
            }
          ): Promise<ReceiptPdfSnapshot>;
        }
      ).loadSourceSnapshot(client, "receipt-1", {
        sourceRevisionNo: 2,
        reviewId: "review-return-2"
      })
    ).rejects.toThrow("收货照片数量超过 PDF 生成上限");
    expect(client.user.findMany).not.toHaveBeenCalled();
  });

  it("在读取下一张证据后立即拒绝超过 96 MiB 的 PDF 输入", async () => {
    const oversizedBuffer = {
      length: 96 * 1024 * 1024 + 1
    } as Buffer;
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: {},
        buffer: oversizedBuffer
      })
    };
    const service = new SpotProcurementReceiptPdfService(
      {} as never,
      files as never,
      { record: jest.fn() } as never
    );

    await expect(
      (
        service as unknown as {
          loadWatermarkedEvidence(
            photoFacts: ReceiptPdfSnapshot["photoFacts"]
          ): Promise<unknown>;
        }
      ).loadWatermarkedEvidence([
        snapshot().photoFacts[0]
      ])
    ).rejects.toThrow(
      "收货水印照片总大小超过 PDF 生成上限"
    );
    expect(files.getFileBuffer).toHaveBeenCalledTimes(1);
  });

  it("事务外只读水印图，事务内锁收货根单并更新单一 PDF 指针与替换链", async () => {
    const sourceTx = pdfTx();
    sourceTx.pdfDocument.findFirst.mockResolvedValueOnce(null);
    const associationTx = pdfTx();
    associationTx.$queryRaw.mockResolvedValue([{ id: "receipt-1" }]);
    associationTx.pdfDocument.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "pdf-1", fileId: "old-file" });
    associationTx.pdfDocument.update.mockResolvedValue({
      id: "pdf-1",
      businessType: RECEIPT_PDF_BUSINESS_TYPE,
      businessId: "receipt-1",
      fileId: "new-file",
      templateKey: RECEIPT_PDF_TEMPLATE_KEY,
      createdAt: sourceTime
    });
    const prisma = transactionPrisma(sourceTx, associationTx);
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#eeeeee" }
    })
      .png()
      .toBuffer();
    const hashes = [
      createHash("sha256").update(png).digest("hex"),
      createHash("sha256").update(png).digest("hex")
    ];
    const files = {
      getFileBuffer: jest
        .fn()
        .mockResolvedValueOnce(fileBuffer("wm-scene-r1", png, hashes[0]))
        .mockResolvedValueOnce(fileBuffer("wm-delivery-r2", png, hashes[1])),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "new-file" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined)
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SpotProcurementReceiptPdfService(
      prisma as never,
      files as never,
      audit as never
    );
    const source = snapshot({
      photoFacts: snapshot().photoFacts.map((photo, index) => ({
        ...photo,
        watermarkedSha256: hashes[index]
      }))
    });
    const internal = service as unknown as {
      loadSourceSnapshot: jest.Mock;
      renderPdf: jest.Mock;
    };
    internal.loadSourceSnapshot = jest.fn().mockResolvedValue(source);
    internal.renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-receipt"));

    await service.refreshLatest(
      "receipt-1",
      "director-1",
      "receipt.review.returned",
      { sourceRevisionNo: 2, reviewId: "review-return-2" }
    );

    expect(files.getFileBuffer.mock.calls.map(([fileId]) => fileId)).toEqual([
      "wm-scene-r1",
      "wm-delivery-r2"
    ]);
    expect(files.getFileBuffer).not.toHaveBeenCalledWith(
      expect.stringContaining("original")
    );
    expect(internal.renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "滨江项目",
        review: expect.objectContaining({ decision: "returned" }),
        photos: [
          expect.objectContaining({ watermarkedFileId: "wm-scene-r1", buffer: png }),
          expect.objectContaining({ watermarkedFileId: "wm-delivery-r2", buffer: png })
        ]
      })
    );
    expect(associationTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      associationTx.pdfDocument.findFirst.mock.invocationCallOrder[0]
    );
    expect(files.linkFileReplacement).toHaveBeenCalledWith(associationTx, {
      newFileId: "new-file",
      oldFileId: "old-file",
      actorUserId: "director-1"
    });
    expect(associationTx.pdfDocument.update).toHaveBeenCalledWith({
      where: { id: "pdf-1" },
      data: { fileId: "new-file" }
    });
    expect(associationTx.pdfDocument.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      associationTx,
      expect.objectContaining({
        action: "spot_procurement.receipt.pdf.refresh",
        businessType: RECEIPT_PDF_BUSINESS_TYPE,
        businessId: "receipt-1",
        metadata: expect.objectContaining({
          pdfDocumentId: "pdf-1",
          newFileId: "new-file",
          oldFileId: "old-file",
          sourceSnapshotToken: source.token
        })
      })
    );
  });

  it("当成功审计与当前指针同源且 token 相同时幂等返回，不再读图或上传", async () => {
    const current = {
      id: "pdf-current",
      businessType: RECEIPT_PDF_BUSINESS_TYPE,
      businessId: "receipt-1",
      fileId: "file-current",
      templateKey: RECEIPT_PDF_TEMPLATE_KEY,
      createdAt: sourceTime
    };
    const source = snapshot();
    const tx = pdfTx();
    tx.pdfDocument.findFirst.mockResolvedValue(current);
    tx.auditLog.findFirst.mockResolvedValue({
      metadata: {
        pdfDocumentId: current.id,
        newFileId: current.fileId,
        sourceSnapshotToken: source.token
      }
    });
    const prisma = transactionPrisma(tx);
    const files = {
      getFileBuffer: jest.fn(),
      uploadPrivateFile: jest.fn(),
      linkFileReplacement: jest.fn()
    };
    const service = new SpotProcurementReceiptPdfService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );
    (
      service as unknown as { loadSourceSnapshot: jest.Mock }
    ).loadSourceSnapshot = jest.fn().mockResolvedValue(source);

    await expect(
      service.refreshLatest("receipt-1", "director-1", "receipt.review.returned", {
        sourceRevisionNo: 2,
        reviewId: "review-return-2"
      })
    ).resolves.toEqual(current);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("采购办结锁定只固定既有正式 PDF，不因根单锁定时间变化重新生成", async () => {
    const current = {
      id: "pdf-current",
      businessType: RECEIPT_PDF_BUSINESS_TYPE,
      businessId: "receipt-1",
      fileId: "file-current",
      templateKey: RECEIPT_PDF_TEMPLATE_KEY,
      createdAt: sourceTime
    };
    const reviewed = snapshot({
      token: {
        ...snapshot().token,
        receiptStatus: "reviewed",
        reviewId: "review-approved-2",
        latestReviewId: "review-approved-2",
        factFingerprint: "reviewed-facts"
      },
      renderInput: renderInput({
        receiptStatus: "reviewed",
        review: {
          id: "review-approved-2",
          decision: "approved",
          conclusion: "复核通过",
          reviewerName: "物资主管丙",
          reviewedAt,
          comment: "数量和照片一致",
          targetReviewId: null
        }
      })
    });
    const locked = snapshot({
      token: {
        ...reviewed.token,
        receiptStatus: "locked",
        receiptUpdatedAt: new Date(
          "2026-07-17T10:00:00.000Z"
        ).toISOString(),
        factFingerprint: "locked-root-facts"
      },
      renderInput: {
        ...reviewed.renderInput,
        receiptStatus: "locked"
      }
    });
    const tx = pdfTx();
    tx.pdfDocument.findFirst.mockResolvedValue(current);
    tx.auditLog.findFirst.mockResolvedValue({
      metadata: {
        pdfDocumentId: current.id,
        newFileId: current.fileId,
        sourceSnapshotToken: reviewed.token
      }
    });
    const prisma = transactionPrisma(tx);
    const files = {
      getFileBuffer: jest.fn(),
      uploadPrivateFile: jest.fn(),
      linkFileReplacement: jest.fn()
    };
    const service = new SpotProcurementReceiptPdfService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );
    (
      service as unknown as { loadSourceSnapshot: jest.Mock }
    ).loadSourceSnapshot = jest.fn().mockResolvedValue(locked);

    await expect(
      service.refreshLatest(
        "receipt-1",
        "director-1",
        "receipt.pdf.manual_retry",
        {
          sourceRevisionNo: 2,
          reviewId: "review-approved-2"
        }
      )
    ).resolves.toEqual(current);
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("二次核对发现照片或复核事实漂移时不覆盖指针，只隔离确认未绑定的派生 PDF", async () => {
    const sourceTx = pdfTx();
    sourceTx.pdfDocument.findFirst.mockResolvedValue(null);
    const associationTx = pdfTx();
    associationTx.$queryRaw.mockResolvedValue([{ id: "receipt-1" }]);
    const cleanupTx = pdfTx();
    cleanupTx.$queryRaw.mockResolvedValue([{ id: "receipt-1" }]);
    cleanupTx.pdfDocument.findFirst.mockResolvedValue(null);
    cleanupTx.fileObject.findUnique.mockResolvedValue({
      id: "stale-file",
      uploadedByUserId: "director-1",
      storageStatus: "active",
      supersedesFileObjectId: null
    });
    cleanupTx.fileObject.findFirst.mockResolvedValue(null);
    cleanupTx.fileObject.updateMany.mockResolvedValue({ count: 1 });
    const prisma = transactionPrisma(sourceTx, associationTx, cleanupTx);
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#dddddd" }
    })
      .png()
      .toBuffer();
    const hash = createHash("sha256").update(png).digest("hex");
    const before = snapshot({
      photoFacts: [
        { ...snapshot().photoFacts[0], watermarkedSha256: hash }
      ]
    });
    const after = snapshot({
      token: { ...snapshot().token, factFingerprint: "facts-v2" },
      photoFacts: [
        { ...snapshot().photoFacts[0], watermarkedSha256: hash }
      ]
    });
    const files = {
      getFileBuffer: jest
        .fn()
        .mockResolvedValue(fileBuffer("wm-scene-r1", png, hash)),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "stale-file" }),
      linkFileReplacement: jest.fn()
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SpotProcurementReceiptPdfService(
      prisma as never,
      files as never,
      audit as never
    );
    const internal = service as unknown as {
      loadSourceSnapshot: jest.Mock;
      renderPdf: jest.Mock;
    };
    internal.loadSourceSnapshot = jest
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    internal.renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-stale"));

    await expect(
      service.refreshLatest("receipt-1", "director-1", "receipt.review.returned", {
        sourceRevisionNo: 2,
        reviewId: "review-return-2"
      })
    ).rejects.toThrow("收货或复核事实已变化");
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(associationTx.pdfDocument.create).not.toHaveBeenCalled();
    expect(associationTx.pdfDocument.update).not.toHaveBeenCalled();
    expect(cleanupTx.fileObject.updateMany).toHaveBeenCalledWith({
      where: {
        id: "stale-file",
        uploadedByUserId: "director-1",
        storageStatus: "active",
        supersedesFileObjectId: null
      },
      data: { storageStatus: "quarantined" }
    });
    expect(audit.record).toHaveBeenCalledWith(
      cleanupTx,
      expect.objectContaining({
        action: "spot_procurement.receipt.pdf.orphan_file",
        metadata: expect.objectContaining({
          orphanFileId: "stale-file",
          reason: "stale_snapshot",
          cleanupStatus: "quarantined"
        })
      })
    );
  });

  it("提交结果不明时保留已绑定或已接入 replacement 链的文件", async () => {
    const tx = pdfTx();
    tx.$queryRaw.mockResolvedValue([{ id: "receipt-1" }]);
    tx.pdfDocument.findFirst.mockResolvedValue({
      id: "pdf-concurrent",
      businessType: RECEIPT_PDF_BUSINESS_TYPE,
      businessId: "receipt-1"
    });
    const prisma = transactionPrisma(tx);
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SpotProcurementReceiptPdfService(
      prisma as never,
      {} as never,
      audit as never
    );

    await (
      service as unknown as {
        handleUnlinkedFile(input: {
          receiptId: string;
          actorUserId: string;
          trigger: string;
          orphanFileId: string;
          reason: "association_failed";
        }): Promise<void>;
      }
    ).handleUnlinkedFile({
      receiptId: "receipt-1",
      actorUserId: "director-1",
      trigger: "receipt.review.approved",
      orphanFileId: "maybe-linked-file",
      reason: "association_failed"
    });

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          cleanupStatus: "bound_pdf_preserved",
          boundPdfDocumentId: "pdf-concurrent"
        })
      })
    );
  });

  it("tryRefreshLatest 不反噬主业务，且失败审计不泄露底层错误文本", async () => {
    const tx = pdfTx();
    const prisma = transactionPrisma(tx);
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SpotProcurementReceiptPdfService(
      prisma as never,
      {} as never,
      audit as never
    );
    const error = new Error("cos://private/secret-token");
    error.name = "StorageError";
    jest.spyOn(service, "refreshLatest").mockRejectedValue(error);

    await expect(
      service.tryRefreshLatest("receipt-1", "director-1", "receipt.review.approved", {
        sourceRevisionNo: 2,
        reviewId: "review-approved-2"
      })
    ).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.receipt.pdf.refresh_failed",
        metadata: {
          retryable: true,
          status: "retryable",
          trigger: "receipt.review.approved",
          templateKey: RECEIPT_PDF_TEMPLATE_KEY,
          sourceRevisionNo: 2,
          reviewId: "review-approved-2",
          errorType: "StorageError",
          errorSummary: "收货确认单生成失败，可稍后重试"
        }
      })
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("secret-token");
  });

  it("渲染 A4 横版汇总页，并为每张正式水印现场图和送货单生成附页", async () => {
    const first = await sharp({
      create: { width: 320, height: 180, channels: 3, background: "#f2c94c" }
    })
      .jpeg()
      .toBuffer();
    const second = await sharp({
      create: { width: 180, height: 320, channels: 3, background: "#56ccf2" }
    })
      .png()
      .toBuffer();
    const buffer = await renderSpotProcurementReceiptPdf(
      renderInput({
        photos: [
          {
            id: "photo-1",
            receiptRevisionNo: 1,
            watermarkedFileId: "wm-1",
            category: "material_scene",
            source: "camera",
            note: "卸货现场",
            appendReason: null,
            uploadedByName: "物资员甲",
            serverRecordedAt: sourceTime,
            buffer: first
          },
          {
            id: "photo-2",
            receiptRevisionNo: 2,
            watermarkedFileId: "wm-2",
            category: "delivery_note",
            source: "album",
            note: "乙方送货单",
            appendReason: "退回后补充",
            uploadedByName: "受托人乙",
            serverRecordedAt: reviewedAt,
            buffer: second
          }
        ]
      })
    );
    const pdf = await PdfLibDocument.load(buffer);
    const [summaryPage] = pdf.getPages();
    const { width, height } = summaryPage.getSize();

    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it("多页材料明细后为物资主管复核区另起可用页面空间", async () => {
    const baseLine = renderInput().lines[0];
    const buffer = await renderSpotProcurementReceiptPdf(
      renderInput({
        photos: [],
        lines: Array.from({ length: 30 }, (_, index) => ({
          ...baseLine,
          sortOrder: index + 1,
          materialName: `材料-${index + 1}`,
          note: `第 ${index + 1} 行现场复核说明`
        }))
      })
    );
    const pdf = await PdfLibDocument.load(buffer);

    expect(buffer.subarray(0, 5).toString("ascii")).toBe(
      "%PDF-"
    );
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
  });
});

function sourceClient() {
  const receipt = {
    id: "receipt-1",
    projectId: "project-1",
    procurementId: "procurement-1",
    procurementVersionId: "version-v1",
    status: "returned",
    currentRevisionNo: 3,
    updatedAt: sourceTime
  };
  const review = {
    id: "review-return-2",
    receiptId: "receipt-1",
    receiptRevisionNo: 2,
    procurementId: "procurement-1",
    procurementVersionId: "version-v1",
    sequenceNo: 2,
    decision: "returned",
    comment: "请补充送货单",
    reviewedByUserId: "director-1",
    reviewedByNameSnapshot: "物资主管丙",
    submissionDelegationId: "delegation-1",
    targetReviewId: null,
    createdAt: reviewedAt
  };
  return {
    spotProcurementReceipt: { findUnique: jest.fn().mockResolvedValue(receipt) },
    spotProcurementReceiptReview: {
      findFirst: jest.fn().mockResolvedValue(review),
      findUnique: jest.fn().mockResolvedValue(review),
      findMany: jest.fn().mockResolvedValue([review])
    },
    spotProcurementReceiptRevision: {
      findUnique: jest.fn().mockResolvedValue({
        id: "revision-2",
        receiptId: "receipt-1",
        revisionNo: 2,
        procurementId: "procurement-1",
        procurementVersionId: "version-v1",
        handlerUserId: "handler-1",
        note: "现场核对完成",
        actualCostCents: 7_200n,
        submittedAt,
        submittedByUserId: "delegate-1",
        submissionDelegationId: "delegation-1",
        updatedAt: sourceTime
      }),
      findMany: jest.fn().mockResolvedValue([{ revisionNo: 1 }, { revisionNo: 2 }])
    },
    spotProcurement: {
      findUnique: jest.fn().mockResolvedValue({
        id: "procurement-1",
        projectId: "project-1",
        code: "LXCG-2026-001",
        supplierNameSnapshot: "城东建材商店",
        updatedAt: sourceTime
      })
    },
    spotProcurementVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "version-v1",
        procurementId: "procurement-1",
        versionNo: 1,
        totalAmountCents: 10_000n,
        updatedAt: sourceTime
      })
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: "project-1",
        code: "XM-001",
        name: "滨江项目",
        updatedAt: sourceTime
      })
    },
    spotProcurementLine: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "line-1",
          versionId: "version-v1",
          sortOrder: 1,
          materialName: "免烧砖",
          specification: "240x115x53",
          unit: "块",
          quantity: new Prisma.Decimal("100"),
          unitPrice: new Prisma.Decimal("0.8"),
          amountCents: 10_000n,
          invoiceMode: "invoice",
          invoiceType: "vat_special",
          vatRateValueSnapshot: new Prisma.Decimal("0.13"),
          vatRateLabelSnapshot: "13%",
          usageLocation: "1#楼",
          note: "承重墙",
          createdAt: sourceTime
        }
      ])
    },
    spotProcurementReceiptLine: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "receipt-line-1",
          receiptId: "receipt-1",
          receiptRevisionNo: 2,
          procurementId: "procurement-1",
          procurementVersionId: "version-v1",
          procurementLineId: "line-1",
          approvedQuantitySnapshot: new Prisma.Decimal("100"),
          qualifiedQuantity: new Prisma.Decimal("90"),
          unqualifiedQuantity: new Prisma.Decimal("5"),
          unqualifiedReason: "5块破损",
          freeGiftQuantity: new Prisma.Decimal("2"),
          replenishmentPending: false,
          discrepancyNote: "少货10块",
          actualCostCents: 7_200n,
          createdAt: sourceTime,
          updatedAt: sourceTime
        }
      ])
    },
    spotProcurementReceiptPhoto: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "photo-scene-r1",
          receiptId: "receipt-1",
          receiptRevisionNo: 1,
          originalFileId: "original-scene-r1",
          watermarkedFileId: "wm-scene-r1",
          originalSha256: "c".repeat(64),
          watermarkedSha256: "a".repeat(64),
          source: "camera",
          category: "material_scene",
          serverRecordedAt: sourceTime,
          note: "首次到货",
          uploadedByUserId: "handler-1",
          lockedAtFirstSubmission: true,
          lockedAt: submittedAt,
          appendReason: null,
          createdAt: sourceTime,
          updatedAt: sourceTime
        },
        {
          id: "photo-delivery-r2",
          receiptId: "receipt-1",
          receiptRevisionNo: 2,
          originalFileId: "original-delivery-r2",
          watermarkedFileId: "wm-delivery-r2",
          originalSha256: "d".repeat(64),
          watermarkedSha256: "b".repeat(64),
          source: "album",
          category: "delivery_note",
          serverRecordedAt: reviewedAt,
          note: "送货单",
          uploadedByUserId: "delegate-1",
          lockedAtFirstSubmission: true,
          lockedAt: reviewedAt,
          appendReason: "按退回意见补充",
          createdAt: reviewedAt,
          updatedAt: reviewedAt
        }
      ])
    },
    spotProcurementReceiptDelegation: {
      findUnique: jest.fn().mockResolvedValue({
        id: "delegation-1",
        receiptId: "receipt-1",
        delegatorUserId: "handler-1",
        delegateUserId: "delegate-1",
        scope: "receipt_confirmation",
        delegatedAt: sourceTime,
        revokedAt: reviewedAt,
        revokedByUserId: "handler-1",
        revocationReason: "收货已完成",
        createdAt: sourceTime
      })
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: "handler-1", name: "物资员甲", updatedAt: sourceTime },
        { id: "delegate-1", name: "受托人乙", updatedAt: sourceTime },
        { id: "director-1", name: "物资主管已改名", updatedAt: sourceTime }
      ])
    }
  };
}

function pdfTx() {
  return {
    $queryRaw: jest.fn(),
    pdfDocument: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    auditLog: { findFirst: jest.fn(), create: jest.fn() },
    fileObject: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn()
    }
  };
}

function transactionPrisma(...transactions: unknown[]) {
  const callbacks = [...transactions];
  return {
    $transaction: jest.fn().mockImplementation(async (callback: (tx: unknown) => unknown) => {
      const tx = callbacks.shift();
      if (!tx) throw new Error("missing mocked transaction");
      return callback(tx);
    })
  };
}

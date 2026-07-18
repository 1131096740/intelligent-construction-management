import { SpotProcurementPaymentArchiveService } from "./spot-procurement-payment-archive.service";
import { PDFDocument } from "pdf-lib";

describe("SpotProcurementPaymentArchiveService", () => {
  it("creates an append-only payment archive version with the A5 original first", async () => {
    const source = {
      payment: { code: "LXCG-001-V1-P001" },
      snapshot: {
        trigger: "payment.execution.record",
        paymentCode: "LXCG-001-V1-P001",
        projectName: "一号项目",
        merchantName: "利民建材店",
        payeeName: "利民建材店",
        merchantPayeeMismatchNote: null,
        payerCompanyName: "四川建工智管建筑工程有限公司",
        approvalAmountCents: "440000",
        paidAmountCents: "440000",
        refundAmountCents: "0",
        netPaidAmountCents: "440000",
        remainingAmountCents: "0",
        paymentStatus: "paid",
        generatedAt: "2026-07-18T08:00:00.000Z"
      },
      files: [
        {
          fileId: "a5-original",
          fileRole: "payment_approval_original_pdf",
          sortOrder: 0
        },
        { fileId: "voucher-1", fileRole: "payment_execution_voucher:1", sortOrder: 0 },
        { fileId: "invoice-1", fileRole: "payment_invoice", sortOrder: 0 }
      ],
      detail: {
        snapshot: {
          trigger: "payment.execution.record",
          paymentCode: "LXCG-001-V1-P001",
          projectName: "一号项目",
          merchantName: "利民建材店",
          payeeName: "利民建材店",
          merchantPayeeMismatchNote: null,
          payerCompanyName: "四川建工智管建筑工程有限公司",
          approvalAmountCents: "440000",
          paidAmountCents: "440000",
          refundAmountCents: "0",
          netPaidAmountCents: "440000",
          remainingAmountCents: "0",
          paymentStatus: "paid",
          generatedAt: "2026-07-18T08:00:00.000Z"
        },
        version: { reason: "新运粮河施工急需零星材料" },
        paymentLines: [
          {
            materialName: "钢筋",
            specification: "HRB400",
            unit: "吨",
            quantity: "2",
            unitPrice: "4000",
            amountCents: 440000n,
            expectedInvoiceCondition: "expected",
            vatRateLabel: "13%"
          }
        ],
        channels: [],
        attachmentDirectory: [],
        methods: ["bank_transfer"],
        executions: [],
        refund: null
      }
    };
    const archiveTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "payment-1" }]),
      spotProcurementPaymentArchive: {
        findFirst: jest.fn().mockResolvedValue({ versionNo: 2 }),
        create: jest.fn().mockResolvedValue({ id: "archive-3", versionNo: 3 })
      },
      spotProcurementPaymentArchiveFile: { createMany: jest.fn().mockResolvedValue({ count: 4 }) }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback({}))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(archiveTx))
    };
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const files = {
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "a4-detail" })
        .mockResolvedValueOnce({ id: "archive-package" }),
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "a5-original" },
        buffer: Buffer.from(await pdf.save())
      })
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SpotProcurementPaymentArchiveService(
      prisma as never,
      files as never,
      audit as never
    );
    (service as unknown as { loadSource: jest.Mock }).loadSource = jest
      .fn()
      .mockResolvedValue(source);

    await expect(
      service.createVersion("payment-1", "finance-1", "payment.execution.record")
    ).resolves.toEqual({ id: "archive-3", versionNo: 3 });

    const detailUpload = files.uploadPrivateFile.mock.calls.find(
      ([input]) =>
        input.originalName === "项目零星付款明细附页-LXCG-001-V1-P001.pdf"
    )?.[0];
    expect(detailUpload).toBeDefined();
    const detailPdf = await PDFDocument.load(detailUpload!.buffer);
    expect(detailPdf.getPageCount()).toBe(1);
    expect(detailPdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(detailPdf.getPage(0).getHeight()).toBeCloseTo(841.89, 1);

    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: "项目零星付款明细附页-LXCG-001-V1-P001.pdf",
        mimeType: "application/pdf"
      })
    );
    expect(archiveTx.spotProcurementPaymentArchive.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: "payment-1",
        versionNo: 3,
        archiveTrigger: "payment.execution.record",
        generatedPackageFileId: "archive-package"
      })
    });
    expect(archiveTx.spotProcurementPaymentArchiveFile.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          archiveId: "archive-3",
          fileId: "a5-original",
          fileRole: "payment_approval_original_pdf"
        }),
        expect.objectContaining({
          archiveId: "archive-3",
          fileId: "a4-detail",
          fileRole: "payment_detail_pdf"
        }),
        expect.objectContaining({
          archiveId: "archive-3",
          fileId: "archive-package",
          fileRole: "payment_archive_package_pdf"
        })
      ])
    });
  });

  it("records only a safe retryable audit when a derived archive version fails", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SpotProcurementPaymentArchiveService(
      { $transaction: jest.fn() } as never,
      { uploadPrivateFile: jest.fn() } as never,
      audit as never
    );
    jest.spyOn(service, "createVersion").mockRejectedValue(new Error("private token=secret"));

    await service.tryCreateVersion("payment-1", "finance-1", "payment.invoice.append");

    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "spot_procurement.payment_archive.generate_failed",
        metadata: expect.objectContaining({ retryable: true })
      })
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("secret");
  });
});

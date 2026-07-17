import { ConflictException, ForbiddenException } from "@nestjs/common";
import { SpotProcurementInvoiceService, deriveInvoiceStatus } from "./spot-procurement-invoice.service";

const now = new Date("2026-07-18T08:00:00.000Z");

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    projectId: "project-1",
    procurementId: "procurement-1",
    procurementVersionId: "version-1",
    status: "approved_pending_payment",
    paymentType: "company_direct",
    factsFrozenAt: now,
    handlerUserId: "handler-1",
    invalidatedAt: null,
    ...overrides
  };
}

function procurement(overrides: Record<string, unknown> = {}) {
  return {
    id: "procurement-1",
    projectId: "project-1",
    currentVersionId: "version-1",
    status: "approved_in_progress",
    ...overrides
  };
}

function context(roleKey = "material_staff") {
  const invoices: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn(),
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementPaymentInvoice: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => {
        const invoice = {
          id: `invoice-${invoices.length + 1}`,
          createdAt: now,
          invalidatedAt: null,
          invalidatedByUserId: null,
          invalidationReason: null,
          ...data
        };
        invoices.push(invoice);
        return Promise.resolve(invoice);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentLine: { findMany: jest.fn().mockResolvedValue([]) },
    fileObject: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const prisma = { $transaction: jest.fn(async (operation) => operation(tx)) };
  const files = {
    assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({
      id: "file-1",
      mimeType: "application/pdf",
      uploadedByUserId: "handler-1",
      storageStatus: "active"
    })
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const pilot = { assertEnabled: jest.fn() };
  return {
    service: new SpotProcurementInvoiceService(
      prisma as never,
      audit as never,
      files as never,
      pilot as never
    ),
    tx,
    files,
    audit,
    invoices
  };
}

describe("SpotProcurementInvoiceService", () => {
  it("derives the lightweight payment-level invoice status from expected conditions and active files", () => {
    expect(deriveInvoiceStatus(["no_invoice"], 0)).toBe("not_required");
    expect(deriveInvoiceStatus(["vat_general", "no_invoice"], 0)).toBe("pending");
    expect(deriveInvoiceStatus(["no_invoice"], 1)).toBe("uploaded");
  });

  it("lets the handler append one image or PDF without structured invoice facts", async () => {
    const { service, tx, audit } = context();
    tx.$queryRaw
      .mockResolvedValueOnce([payment()])
      .mockResolvedValueOnce([procurement()]);

    const result = await service.append("payment-1", "handler-1", {
      fileId: "file-1"
    });

    expect(result).toMatchObject({
      paymentId: "payment-1",
      fileId: "file-1",
      status: "active",
      uploadedByUserId: "handler-1"
    });
    expect(tx.spotProcurementPaymentInvoice.create).toHaveBeenCalledWith({
      data: {
        paymentId: "payment-1",
        fileId: "file-1",
        status: "active",
        uploadedByUserId: "handler-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "spot_procurement.invoice.append" })
    );
  });

  it("allows project finance staff but rejects another material user", async () => {
    const finance = context("finance_staff");
    finance.tx.$queryRaw
      .mockResolvedValueOnce([payment()])
      .mockResolvedValueOnce([procurement()]);
    finance.files.assertFileHasNoBusinessBinding.mockResolvedValue({
      id: "file-2",
      mimeType: "image/jpeg",
      uploadedByUserId: "finance-1",
      storageStatus: "active"
    });
    await expect(
      finance.service.append("payment-1", "finance-1", { fileId: "file-2" })
    ).resolves.toMatchObject({ uploadedByUserId: "finance-1" });

    const otherMaterial = context("material_staff");
    otherMaterial.tx.$queryRaw
      .mockResolvedValueOnce([payment()])
      .mockResolvedValueOnce([procurement()]);
    await expect(
      otherMaterial.service.append("payment-1", "other-material-1", {
        fileId: "file-1"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows pre-closure invalidation but keeps closed procurements append-only", async () => {
    const open = context();
    const existing = {
      id: "invoice-1",
      paymentId: "payment-1",
      fileId: "file-1",
      status: "active",
      uploadedByUserId: "handler-1",
      invalidatedAt: null,
      invalidatedByUserId: null,
      invalidationReason: null,
      createdAt: now
    };
    open.tx.$queryRaw
      .mockResolvedValueOnce([payment()])
      .mockResolvedValueOnce([procurement()]);
    open.tx.spotProcurementPaymentInvoice.findFirst.mockResolvedValue(existing);
    await expect(
      open.service.invalidate("payment-1", "invoice-1", "handler-1", {
        reason: "上传了错误图片"
      })
    ).resolves.toMatchObject({ status: "invalidated" });

    const closed = context();
    closed.tx.$queryRaw
      .mockResolvedValueOnce([payment()])
      .mockResolvedValueOnce([procurement({ status: "closed" })]);
    await expect(
      closed.service.invalidate("payment-1", "invoice-1", "handler-1", {
        reason: "办结后不应作废"
      })
    ).rejects.toEqual(
      new ConflictException("采购办结或异常终止后只能追加发票，不能作废既有附件")
    );
  });
});

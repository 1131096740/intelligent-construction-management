import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import sharpModule = require("sharp");
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { FileService } from "../file/file.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { SpotProcurementPaymentController } from "./spot-procurement-payment.controller";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";
import { SpotProcurementReceiptService } from "./spot-procurement-receipt.service";
import { SpotProcurementController } from "./spot-procurement.controller";

const sharp = sharpModule as unknown as typeof import("sharp").default;

const file = {
  originalname: "付款凭证.png",
  mimetype: "image/png",
  size: 3,
  buffer: Buffer.from("png")
};
const actor = { id: "user-1" } as never;

describe("spot procurement business file upload controllers", () => {
  it("checks project create capability before storing a create attachment", async () => {
    const order: string[] = [];
    const reads = {
      assertCreateActionAvailable: jest.fn(async () => order.push("capability"))
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-1" };
      })
    };
    const controller = new SpotProcurementController(
      {} as never,
      reads as never,
      {} as never,
      {} as never,
      files as never
    );

    await expect(
      controller.uploadCreateDraftFile("project-1", file, actor, {
        idempotencyKey: "key-1"
      })
    ).resolves.toEqual({ id: "file-1" });
    expect(order).toEqual(["capability", "storage"]);
    expect(reads.assertCreateActionAvailable).toHaveBeenCalledWith(
      "user-1",
      "project-1"
    );
    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "key-1" })
    );
  });

  it("checks exact procurement edit capability before storing a draft attachment", async () => {
    const order: string[] = [];
    const reads = {
      assertProcurementActionAvailable: jest.fn(async () =>
        order.push("capability")
      )
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-2" };
      })
    };
    const controller = new SpotProcurementController(
      {} as never,
      reads as never,
      {} as never,
      {} as never,
      files as never
    );

    await controller.uploadDraftFile("procurement-1", file, actor, {
      idempotencyKey: "key-2"
    });
    expect(order).toEqual(["capability", "storage"]);
    expect(reads.assertProcurementActionAvailable).toHaveBeenCalledWith(
      "procurement-1",
      "user-1",
      "edit_draft"
    );
    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "key-2" })
    );
  });

  it.each([
    ["uploadDraftFile", "edit_draft"],
    ["uploadExecutionVoucherFile", "record_execution"]
  ] as const)("checks exact payment capability before %s storage", async (method, action) => {
    const order: string[] = [];
    const reads = {
      assertPaymentActionAvailable: jest.fn(async () => order.push("capability"))
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-payment" };
      })
    };
    const controller = new SpotProcurementPaymentController(
      {} as never,
      reads as never,
      {} as never,
      files as never
    );

    await controller[method]("payment-1", file, actor);
    expect(order).toEqual(["capability", "storage"]);
    expect(reads.assertPaymentActionAvailable).toHaveBeenCalledWith(
      "payment-1",
      "user-1",
      action
    );
  });

  it("reads execution voucher idempotency from the complete multipart body", async () => {
    const reads = { assertPaymentActionAvailable: jest.fn() };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-payment" }) };
    const controller = new SpotProcurementPaymentController(
      {} as never,
      reads as never,
      {} as never,
      files as never
    );

    await controller.uploadExecutionVoucherFile("payment-1", file, actor, {
      idempotencyKey: "execution-key-1"
    });

    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "execution-key-1" })
    );
  });

  it.each([
    ["uploadReceiptPhotoFile", "append_receipt_photo"],
    ["uploadRefundVoucherFile", "record_refund"],
    ["uploadInvoiceFile", "append_invoice"]
  ] as const)("checks exact receipt capability before %s storage", async (method, action) => {
    const order: string[] = [];
    const receipts = {
      assertActionAvailable: jest.fn(async () => order.push("capability"))
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-receipt" };
      })
    };
    const controller = new SpotProcurementReceiptController(
      receipts as never,
      files as never
    );

    await controller[method]("procurement-1", file, actor);
    expect(order).toEqual(["capability", "storage"]);
    expect(receipts.assertActionAvailable).toHaveBeenCalledWith(
      "procurement-1",
      "user-1",
      action
    );
  });

  it("keeps every upload route under its business permission", () => {
    const routes = [
      [SpotProcurementController.prototype.uploadCreateDraftFile, "projects/:projectId/draft-file-uploads", "spot_procurement.create"],
      [SpotProcurementController.prototype.uploadDraftFile, ":procurementId/draft-file-uploads", "spot_procurement.create"],
      [SpotProcurementPaymentController.prototype.uploadDraftFile, ":paymentId/draft-file-uploads", "spot_procurement.payment.submit"],
      [SpotProcurementPaymentController.prototype.uploadExecutionVoucherFile, ":paymentId/execution-voucher-file-uploads", "spot_procurement.payment.execute"],
      [SpotProcurementReceiptController.prototype.uploadReceiptPhotoFile, ":procurementId/receipt-photo-file-uploads", "spot_procurement.receipt.confirm"],
      [SpotProcurementReceiptController.prototype.uploadRefundVoucherFile, ":procurementId/refund-voucher-file-uploads", "spot_procurement.refund.record"],
      [SpotProcurementReceiptController.prototype.uploadInvoiceFile, ":procurementId/invoice-file-uploads", "spot_procurement.invoice.append"]
    ] as const;

    for (const [target, path, permission] of routes) {
      expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(path);
      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, target)).toBe(
        permission
      );
    }
  });
});

describe("spot procurement receipt multipart upload HTTP validation", () => {
  let app: INestApplication;
  const receipts = { assertActionAvailable: jest.fn().mockResolvedValue(undefined) };
  const files = { uploadPrivateFile: jest.fn(async (input: { idempotencyKey?: string }) => ({ id: `file-${input.idempotencyKey}` })) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SpotProcurementReceiptController],
      providers: [
        { provide: SpotProcurementReceiptService, useValue: receipts },
        { provide: FileService, useValue: files }
      ]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => {
      request.user = actor;
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => app.close());

  it("generates the receipt fixture at an accepted visible size", async () => {
    const buffer = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#4f8a5b" } }).png().toBuffer();
    const metadata = await sharp(buffer).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 320, height: 240 });
    expect(metadata.pages === undefined || metadata.pages === 1).toBe(true);
  });

  it.each([
    ["receipt photo", "receipt-photo-file-uploads", "receipt-key"],
    ["refund voucher", "refund-voucher-file-uploads", "refund-key"]
  ])("accepts complete multipart body for %s", async (_label, route, idempotencyKey) => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("png")], { type: "image/png" }), "voucher.png");
    form.append("idempotencyKey", idempotencyKey);

    const response = await fetch(`${await app.getUrl()}/spot-procurements/procurement-1/${route}`, { method: "POST", body: form });
    const body = await response.json() as unknown;

    expect({ status: response.status, body }).toEqual({ status: 201, body: { id: `file-${idempotencyKey}` } });
    expect(files.uploadPrivateFile).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey }));
  });
});
